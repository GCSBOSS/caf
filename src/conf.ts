import * as TOML from 'https://deno.land/std@0.83.0/encoding/toml.ts'
import * as YAML from 'https://deno.land/std@0.83.0/encoding/yaml.ts'
import { extname } from 'https://deno.land/std@0.83.0/path/mod.ts'

const isMergeableObject = (val: unknown) =>
    Boolean(val) && typeof val === 'object' &&
        (!val?.constructor || 'Object' === val?.constructor.name)

function deepMerge(...subjects: Dictionary[]){

    const root: Dictionary = {}

    for(const obj of subjects){
        if(!isMergeableObject(obj))
            throw new Error('Cannot merge non-object')

        for(const k in obj)
            root[k] = isMergeableObject(root[k]) && isMergeableObject(obj[k])
                ? deepMerge(root[k] as Dictionary, obj[k] as Dictionary)
                : root[k] = obj[k]
    }

    return root
}

type Dictionary = Record<string, unknown>;

interface Loader {
    [index: string]: (conf: string) => Dictionary;
}

const loaders: Loader = {
    toml: (conf: string) => TOML.parse(conf) as Dictionary,
    yaml: (conf: string) => YAML.parse(conf) as Dictionary,
    json: (conf: string) => JSON.parse(conf) as Dictionary,
    yml: (conf: string) => YAML.parse(conf) as Dictionary
}

function loadConf(conf: string){
    const type = extname(conf).substring(1)

    if(typeof loaders[type] !== 'function')
        throw new Error('Conf type not supported: ' + type)

    return loaders[type](Deno.readTextFileSync(conf))
}

export default function (...subjects: (string | Dictionary)[]){
    const objects = subjects.map(c => typeof c == 'string' ? loadConf(c) : c)
    return deepMerge(...objects)
}
