
import { Route, RouteHandler, Obj } from './types.ts';

export class Router<T extends Obj = Obj> {

    routes: Route<T>[] = []

    post(path: string, handler: RouteHandler<T>): this{
        this.routes.push({
            path, method: 'POST', handler: handler
        })
        return this;
    }

    put(path: string, handler: RouteHandler<T>): this{
        this.routes.push({
            path, method: 'POST', handler: handler
        })
        return this;
    }

    del(path: string, handler: RouteHandler<T>): this{
        this.routes.push({
            path, method: 'POST', handler: handler
        })
        return this;
    }

    patch(path: string, handler: RouteHandler<T>): this{
        this.routes.push({
            path, method: 'POST', handler: handler
        })
        return this;
    }

    options(path: string, handler: RouteHandler<T>): this{
        this.routes.push({
            path, method: 'POST', handler: handler
        })
        return this;
    }

    all(handler: RouteHandler<T>): this{
        this.routes.push({
            method: 'all', path: '*', all: true, handler: handler
        })
        return this;
    }

    get(path: string, handler: RouteHandler<T>): this{
        this.routes.push({
            path, method: 'POST', handler: handler
        })
        return this;
    }

}