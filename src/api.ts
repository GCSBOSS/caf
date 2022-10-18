import { RouteHandler, RouteHandlerArgs, Dictionary, Obj } from './types.ts'
import { App } from './app.ts'
import { handleError } from './error.ts'
import { assert } from "https://deno.land/std@0.160.0/testing/asserts.ts";
import CafResponse from './response.ts'
import { RequestBody } from './body.ts'
import { getCookies } from "https://deno.land/std@0.159.0/http/cookie.ts";

type DynamicConfig = {
    params: string[],
    regexp: RegExp
}

type DynamicRoute<T extends Obj = Obj> = {
    handler: RouteHandler<T>
} & DynamicConfig

type BoundRouteHandler = (input: RouteHandlerArgs) => Promise<void> | void

function pathToRegexp(path: string): DynamicConfig{
    let regexp = '';
    const params: string[] = [];

    path.split('/').forEach(seg => {
        if(!seg)
            return;

        if(seg[0] == ':'){
            params.push(seg.substring(1));
            regexp += '\\/([\\w\\d\\-\\._~]+)';
            return;
        }

        regexp += '\\/' + seg;
    });

    return { regexp: new RegExp('^' + regexp + '$'), params }
}



// function parseSignedCookies(cconf, input){
//     if(!cconf?.secret)
//         return;

//     for(const key in input.cookies){
//         const val = cookieSignature.unsign(input.cookies[key], cconf?.secret);
//         if(val){
//             input.signedCookies[key] = val;
//             delete input.cookies[key];
//         }
//     }
// }

import { cors } from './cors.ts';

export default class API<T extends Obj = Obj> {

    private routes: Record<string, boolean>
    private context: App<T>
    private static: Record<string, RouteHandler<T>>
    private dynamic: Record<string, DynamicRoute<T>[]>
    private fallbackRoute?: RouteHandler<T>

    private matchRoute(method: string, path: string, params: Dictionary): RouteHandler<T> | false{
        const route = method + ' ' + path;
        if(route in this.static)
            return this.static[route];

        if(this.dynamic[method])
            for(const r of this.dynamic[method]){
                const match = r.regexp.exec(path);
                if(match){
                    r.params.forEach( (p, i) => params[p] = match[i + 1]);
                    return r.handler;
                }
            }

        return  this.fallbackRoute ?? false;
    }

    constructor(context: App<T>){
        this.routes = {};
        this.static = {};
        this.dynamic = {};
        this.context = context;
    }

    setFallbackRoute(handler: RouteHandler<T>){
        assert(!this.fallbackRoute, 'Route for \'ALL\' is already defined');
        assert(typeof handler == 'function',
            `'ALL' handler must be a function. Found '${typeof handler}'`);

        this.fallbackRoute = handler.bind(this.context);
    }

    addEndpoint(method: string, path: string, handler: RouteHandler<T>){

        const m = method.toUpperCase();
        const route = m + ' ' + path;

        const dup = route in this.routes;
        assert(!dup, 'Route for \'' + route + '\' is already defined');

        assert(typeof handler == 'function',
            `'${route}' handler must be a function. Found '${typeof handler}'`);

        const nmHandler = handler.bind(this.context);

        this.routes[route] = true;

        if(path.indexOf('/:') < 0 && path.indexOf('*') < 0)
            return this.static[route] = nmHandler;

        this.dynamic[m] = this.dynamic[m] ?? [];
        const { regexp, params } = pathToRegexp(path);
        this.dynamic[m].push({ regexp, handler: nmHandler, params });
    }

    trigger({
        method,
        headers,
        query,
        path,
        ip,
        body
    }: {
        method: string,
        headers: Headers,
        query: Record<string, string>,
        path: string,
        ip?: string,
        body?: Body
    }): CafResponse{

        const params = {};

        const app = this.context;

        const reqInfo = {
            method,
            path,
            host: headers.get('host'),
            agent: headers.get('user-agent'),
            type: 'request',
            msg: 'Received ' + method + ' request to ' + path
        };

        const res = new CafResponse(reqInfo, app.log);

        cors(app.conf.cors, method, headers, res);
        if(res.finished)
            return res;

        const input: RouteHandlerArgs<T> = {
            ...app.global,
            conf: app.conf,
            cookies: getCookies(headers),
            headers: Object.fromEntries(headers.entries()),
            query,
            params,
            log: app.log,
            // signedCookies: {},
            method,
            path,
            ip: headers.get('x-forwarded-for')?.split(',')[0] ?? ip ?? '::1',
            call: (fn, ...args) => fn.call(app, input, ...args),
            res,
            body: new RequestBody(headers.get('content-type') ?? '', res, body),
        };

        Object.assign(input, app.global);

        app.log.debug(reqInfo);

        const handler = this.matchRoute(input.method, path, params);

        (async function(){

            try{
                res.notFound(!handler);

                // parseSignedCookies(app.conf.cookie, finput);

                await (handler as BoundRouteHandler)(input);
            }
            catch(err){
                handleError(err, reqInfo, res, app.log);
            }

        })();

        return res;
    }

}
