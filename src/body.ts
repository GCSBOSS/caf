
import { getDataTypeFromContentType } from './types.ts'

import CafResponse from './response.ts'

export class RequestBody  {

    private type?: string
    private charset?: string
    private res: CafResponse
    private reqBody?: Body

    constructor(contentType: string, res: CafResponse, reqBody?: Body){
        const t = getDataTypeFromContentType(contentType);
        this.type = t.type;
        this.charset = t.charset;
        this.res = res;
        this.reqBody = reqBody;
    }

    async raw(): Promise<ArrayBuffer>{
        return (await this.parse()) as ArrayBuffer;
    }

    async text(): Promise<string>{
        this.res.badType(!this.charset && this.type != 'text');
        return (await this.parse()) as string;
    }

    async json(): Promise<unknown>{
        this.res.badType(this.type != 'json');
        return (await this.parse()) as unknown;
    }

    async parse(): Promise<unknown>{
        try{
            if(this.type == 'json')
                return await this.reqBody?.json();
            if(this.type == 'text')
                return await this.reqBody?.text();
            return await this.reqBody?.arrayBuffer();
        }
        catch(_err){
            this.res.badRequest(true, 'Invalid format');
        }
    }

}