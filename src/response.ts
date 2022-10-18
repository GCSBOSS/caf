import { ReqInfo } from './types.ts'
import { HTTPError, handleError } from './error.ts'
import { getContentTypeFromDataType } from './types.ts'
import Logger from './logger.ts'
import { Buffer } from "https://deno.land/std@0.133.0/io/mod.ts"
import { sprintf } from 'https://deno.land/std@0.115.0/fmt/printf.ts'
import { setCookie } from "https://deno.land/std@0.160.0/http/cookie.ts";

const SHORT_CONTENT_TYPES: Record<string, string> = {
    'text': 'text/plain',
    'json': 'application/json'
};

type CookieOpts = {
    expires?: Date,
    maxAge?: number,
    signed?: boolean,
    path?: string,
    domain?: string
    secure?: boolean
    httpOnly?: boolean
    overwrite?: boolean
    sameSite?:  "Strict" | "Lax" | "None"
}

export default class CafResponse {

    private reqInfo: ReqInfo
    private log: Logger
    statusCode: number
    private headersSent?: boolean
    stream: ReadableStream<Uint8Array>
    private streamCtrl?: ReadableStreamDefaultController
    headersObj: Headers
    finished?: boolean
    private resolve?: () => void
    sent: Promise<void>
    private body?: Buffer

    /** In case `cond` is falsy, throws HTTP error with `status` and `message` as body printf-formated with `args` */
    assert(status: number, cond: boolean, message?: string, ...args: unknown[]): this{
        if(!cond)
            return this;
        throw this.error(status, message ?? '', ...args);
    }

    /** In case `cond` is falsy, throws Error 400 with `message` as body printf-formated with `args` */
    badRequest(cond: boolean, message?: string, ...args: unknown[]): this {
        return this.assert(400, cond, message, ...args);
    }

    /** In case `cond` is falsy, throws Error 401 with `message` as body printf-formated with `args` */
    unauthorized(cond: boolean, message?: string, ...args: unknown[]): this{
        return this.assert(401, cond, message, ...args);
    }

    /** In case `cond` is falsy, throws Error 403 with `message` as body printf-formated with `args` */
    forbidden(cond: boolean, message?: string, ...args: unknown[]): this{
        return this.assert(403, cond, message, ...args);
    }

    /** In case `cond` is falsy, throws Error 404 with `message` as body printf-formated with `args` */
    notFound(cond: boolean, message?: string, ...args: unknown[]): this{
        return this.assert(404, cond, message, ...args);
    }

    /** In case `cond` is falsy, throws Error 409 with `message` as body printf-formated with `args` */
    conflict(cond: boolean, message?: string, ...args: unknown[]): this{
        return this.assert(409, cond, message, ...args);
    }

    /** In case `cond` is falsy, throws Error 410 with `message` as body printf-formated with `args` */
    gone(cond: boolean, message?: string, ...args: unknown[]): this{
        return this.assert(410, cond, message, ...args);
    }

    /** In case `cond` is falsy, throws Error 415 with `message` as body printf-formated with `args` */
    badType(cond: boolean, message?: string, ...args: unknown[]): this{
        return this.assert(415, cond, message, ...args);
    }

    // /** Respond with an Error 500 */

    /** Respond with an HTTP error in `status` and `message` as body printf-formated with `args` */
    error(status: number, message: unknown, ...args: unknown[]): HTTPError
    error(status: number, message: string, ...args: unknown[]): HTTPError
    error(status: unknown): HTTPError
    error(status: unknown, message?: string, ...args: unknown[]): HTTPError {

        // If it's NOT a status, handle as an Error
        if(!Number.isInteger(status))
            return handleError(status, this.reqInfo, this, this.log);

        this.status(status as number);
        const type = getContentTypeFromDataType(message);

        if(typeof message == 'string')
            message = sprintf(message, ...args.map(a => String(a)))
        else if(type == 'application/json')
            message = JSON.stringify(message);
        else if(type == 'text/plain')
            message = String(message);

        type && this.type(type);
        this.end(message);

        return new HTTPError(status as number, message!, type ?? 'text/plain');
    }

    private sendHead(){
        if(this.headersSent)
            return;

        this.headersSent = true;
        this.resolve?.();
    }

    /** Append `chunk` to the response stream. */
    write(chunk: string | ArrayBuffer): this{

        this.sendHead();

        if(!(chunk instanceof ArrayBuffer))
            chunk = String(chunk);

        if(typeof chunk == 'string')
            chunk = new TextEncoder().encode(chunk);

        this.streamCtrl?.enqueue(new Uint8Array(chunk));

        if(!this.body)
            this.body = new Buffer(chunk);
        else
            this.body.write(new Uint8Array(chunk));

        return this;
    }

    /** Finishes the request. If set, append `body` to the response stream. */
    end(body?: string | ArrayBuffer): void {

        if(this.finished)
            this.log.warn({ err: new Error('Called `res.end()` after response was already finished') });

        body ? this.write(body) : this.sendHead();

        this.streamCtrl?.close();

        this.log.debug({
            ...this.reqInfo,
            status: this.statusCode,
            level: this.statusCode > 499 ? 'warn' : 'debug',
            type: 'response',
            msg: 'Sent ' + this.statusCode + ' response to ' + this.reqInfo.method + ' ' + this.reqInfo.path
        });

        this.finished = true;
    }

    /** Respond with a json body and finishes the request. */
    json(data: unknown){
        this.type('json');
        this.end(JSON.stringify(data));
    }

    /** Respond with a text body and finishes the request. */
    text(data: number | boolean | string){
        this.type('text');
        this.end(String(data));
    }

    /** Set a request header. */
    set(k: string, v: string): this{
        this.headersObj.set(k, v);
        return this;
    }

    get(k: string): string | string[]{
        return this.headersObj.get(k) ?? '';
    }

    /** Append the header to the response. Allow sending duplicated header keys */
    append(k: string, v: string): this{
        this.headersObj.append(k, v);
        return this;
    }

    /** Set content-type header to a know type (json, text) or any mime-type */
    type(ct: string): this{
        this.set('Content-Type', SHORT_CONTENT_TYPES[ct] || ct);
        return this;
    }

    /** Send the request status to client. */
    status(s: number): this{
        this.statusCode = s;
        return this;
    }

    /** Set a cookie according to options. */
    cookie(name: string, value: string, opts?: CookieOpts): this{
        opts = { ...opts };
        opts.path = opts.path || '/';

        value = String(value);

        // if(value && opts.signed && !this.input.conf.cookie?.secret)
        //     throw new Error('Trying to sign cookies when secret is not defined');

        // if(opts.signed && value)
        //     value = sign(value, this.input.conf.cookie.secret);

        if(typeof opts.maxAge == 'number') {
            opts.expires = new Date(Date.now() + opts.maxAge);
            opts.maxAge /= 1000;
        }

        setCookie(this.headersObj, { name, value, ...opts });

        return this;
    }

    /** Clear the cookie identified by `name` and `opts`. */
    clearCookie(name: string, opts?: CookieOpts): this{
        opts = { path: '/', ...opts, expires: new Date(1) };
        delete opts.maxAge;
        return this.cookie(name, '', opts);
    }

    constructor(reqInfo: ReqInfo, logger: Logger){

        this.reqInfo = reqInfo;
        this.log = logger;
        this.sent = new Promise(resolve => {
            this.resolve = resolve;
        });
        this.statusCode = 200;

        this.headersObj = new Headers();
        this.stream = new ReadableStream({
            start: controller => {
                this.streamCtrl = controller;
            }
        });
    }

}

// TODO 406 notAcceptable:
// TODO 405 methodNotAllowed
// TODO 408 Request Timeout
// TODO 411 Length Required
// TODO 413 Payload Too Large
// TODO 414 Request-URI Too Long
// TODO for WS: 426 Upgrade Required
// TODO 429 Too Many Requests
// TODO 431 Request Header Fields Too Large