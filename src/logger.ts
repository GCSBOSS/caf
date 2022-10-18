

import { sprintf } from 'https://deno.land/std@0.115.0/fmt/printf.ts'
type LevelSpec = { w: number, c: string }
type Dict = Record<string, unknown>
type BasicEntry = {
    time: Date,
    level: string,
    type: string,
    msg: string
}

type ParserFunc = (input: Dict) => Dict

const LEVELS: Record<string, LevelSpec> = {
    debug: { w: 0, c: '\x1b[30;5;1m' },
    info: { w: 1, c: '\x1b[0m' },
    warn: { w: 2, c: '\x1b[33m' },
    error: { w: 3, c: '\x1b[31m' },
    fatal: { w: 4, c: '\x1b[41;5;1m' }
};



function output(entry: Dict){
    const env = Deno.env.get('ENV')

    // Output friendly log for dev or undfined env
    /* istanbul ignore next */
    if(!env || env === 'development'){
        const e = entry as BasicEntry;
        const uword = (e.type == 'event' ? e.level : e.type).toUpperCase()
        e.time.setMinutes(e.time.getMinutes() - e.time.getTimezoneOffset())
        const utime = e.time.toISOString().slice(11, -5)
        console.log(LEVELS[e.level].c + utime + ': ' + uword + ' - ' + e.msg + '\x1b[0m')
    }

    // Output complete JSON log for production and staging
    /* istanbul ignore next */
    else if(env !== 'testing')
        console.log(JSON.stringify(entry))
}

function parseErr({ err }: Dict){
    let theErr: Error;

    if(err instanceof Error)
        theErr = err;
    else
        theErr = new Error(err as string)

    const stack = theErr.stack?.split(/[\r\n]+\s*/g)
    const env = Deno.env.get('ENV')

    return {
        err: null,
        // code: theErr.code,
        class: theErr.constructor.name,
        message: theErr.message,
        stack: stack?.slice(1, -1),
        msg: !env || env === 'development'
            ? theErr.stack
            : stack?.[0] + ' ' + stack?.[1]
    }
}

type GoLogConf = {
    defaults?: Dict,
    level?: string,
    only?: string | string[],
    except?: string | string[]
}

export default class Logger {
    parsers: Record<string, ParserFunc> = { err: parseErr }
    private level: string
    private only: Set<string>
    private except: Set<string>
    private defaults: Dict

    private log(level: string, ...args: unknown[]){

        const entry = {
            ...this.defaults,
            ...this.getEntry.call(this, level, args)
        }

        const badLevel = LEVELS[this.level].w > LEVELS[level].w
        const badType = this.except.has(entry.type as string) ||
            this.only.size > 0 && !this.only.has(entry.type as string)
        if(badType || badLevel)
            return false

        output(entry)

        return entry
    }

    debug(...args: unknown[]){ return this.log('debug', ...args) }
    info(...args: unknown[]){ return this.log('info', ...args) }
    warn(...args: unknown[]){ return this.log('warn', ...args) }
    error(...args: unknown[]){ return this.log('error', ...args) }
    fatal(...args: unknown[]){ return this.log('fatal', ...args) }

    constructor(conf: false | GoLogConf = {}){
        if(!conf)
            conf = { only: 'badbadclass' }
        this.level = conf.level || 'debug'
        this.only = new Set([ conf.only ].flat().filter((a): a is string => Boolean(a)))
        this.except = new Set([ conf.except ].flat().filter((a): a is string => Boolean(a)))
        this.defaults = conf.defaults || {}
    }

    addParser(key: string, parser: ParserFunc){
        this.parsers[key] = parser
    }

    private getEntry(level: string, args: unknown[]): BasicEntry{
        const data = typeof args[0] == 'object' ? args.shift() as Dict : {}
        args[0] = args[0] || ''
        let msg = sprintf(args[0] as string, ...args.slice(1).map(a => String(a)))

        const type = data.type as string || 'event'

        for(const key in this.parsers)
            key in data && Object.assign(data, this.parsers[key](data))

        msg = msg || String(data.msg);
        return { level, type, ...data, msg, time: new Date() }
    }
}