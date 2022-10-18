
import { Router } from '../src/mod.ts';
import { Globals } from './types.ts';


export const router = new Router<Globals>();


router.post('/login', async function({ res, redis }){

    const text = await redis.get('abc') ?? 'test';

    res.end(text);
});
