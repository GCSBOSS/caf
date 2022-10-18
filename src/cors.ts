import CafResponse from './response.ts'

export type CorsOptions = {
    origin?: boolean | string | RegExp | (string | RegExp)[];
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
};

const DEFAULT_OPTIONS = {
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    preflightContinue: false
};

function setVaryHeader(res: CafResponse, newValue: string){
    const ha = res.get("Vary");
    const curVal = Array.isArray(ha) ? ha[0] : ha;

    if(curVal == '*')
        return;

    if(newValue == '*')
        return res.set("Vary", '*');

    const values = curVal.split(',').map(item => item.trim().toLowerCase());

    if(!values.includes(newValue.toLowerCase()))
        values.push(newValue.toLowerCase());

    res.set("Vary", values.join(', '));
}


function isOriginAllowed(requestOrigin: string, allowedOrigin: CorsOptions["origin"]): boolean {

    if (Array.isArray(allowedOrigin))
        return allowedOrigin.some((ao) => isOriginAllowed(requestOrigin, ao));

    if (typeof allowedOrigin === "string")
        return requestOrigin === allowedOrigin;

    if (allowedOrigin instanceof RegExp && typeof requestOrigin === "string")
        return allowedOrigin.test(requestOrigin);

    return Boolean(allowedOrigin);
}

function initCors(opts: CorsOptions, origin: string, res: CafResponse){

    const options = { ...DEFAULT_OPTIONS, ...opts };

    /* Configure Origin */
    if (!options.origin || options.origin === "*")
        res.set("Access-Control-Allow-Origin", "*");

    else if (typeof options.origin === "string") {
        res.set("Access-Control-Allow-Origin", options.origin);
        setVaryHeader(res, "Origin");
    }
    else {
        const originAllowed = isOriginAllowed(origin, options.origin)
        res.set("Access-Control-Allow-Origin", originAllowed
              ? origin
              : "false");
        setVaryHeader(res, "Origin");
    }

    /* Configure Credentials */
    if (options.credentials === true)
        res.set("Access-Control-Allow-Credentials", "true");


    /* Configure Exposed Headers */
    const exposedHeaders = options.exposedHeaders;
    if (exposedHeaders?.length)
        res.set("Access-Control-Expose-Headers", Array.isArray(exposedHeaders)
            ? exposedHeaders.join(",")
            : exposedHeaders,
    );
}

function handleOptions(opts: CorsOptions, neededHeaders: string, res: CafResponse){
    const options = { ...DEFAULT_OPTIONS, ...opts };

    /* Configure Methods */
    const methods = options.methods;
    res.set("Access-Control-Allow-Methods",
        Array.isArray(methods) ? methods.join(",") : methods);

    /* Configure Allowed Headers */
    let allowedHeaders = options.allowedHeaders;

    if (!allowedHeaders) {
        allowedHeaders = neededHeaders;
        setVaryHeader(res, "Access-Control-request-Headers");
    }
    if (allowedHeaders?.length) {
        res.set("Access-Control-Allow-Headers", Array.isArray(allowedHeaders)
            ? allowedHeaders.join(",")
            : allowedHeaders);
    }

    /* Configure Max Age */
    if(typeof options.maxAge === "number" || typeof options.maxAge === "string"){
        const maxAge = options.maxAge.toString();
        maxAge.length && res.set("Access-Control-Max-Age", maxAge);
    }

    res.status(204).set('Content-Length', '0').end();
}

export function cors(opts: CorsOptions | undefined, method: string, headers: Headers, res: CafResponse){
    const origin = headers.get('origin');
    const neededHeaders = headers.get('access-control-request-headers') ?? '';
    if(opts && origin){
        initCors(opts, origin, res);

        if(method === "OPTIONS")
            handleOptions(opts, neededHeaders, res)
    }

}