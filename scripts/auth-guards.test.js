const {test} = require('node:test');
const assert = require('node:assert/strict');
const guards = [
  ['booking', require('../Booking_Service/src/middlewares/require-user')],
  ['admin', require('../FlightandSearchService/src/middlewares/require-admin')]
];

for (const [name, guard] of guards) {
  test(`${name} guard fails closed and forwards a traced identity lookup`, async t => {
    let response = {ok:true, json:async()=>({data:{id:42, roles:['ADMIN']}})};
    let calls = 0;
    const fetchMock = t.mock.method(global, 'fetch', async (_url, options) => {
      calls++;
      assert.equal(options.headers['x-access-token'], 'test-token');
      assert.match(options.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      assert.ok(options.signal);
      if (response instanceof Error) throw response;
      return response;
    });
    async function invoke(headers={authorization:'Bearer test-token'}) {
      const result = {next:0};
      const req = {get:key=>headers[key]};
      const res = {status(code){result.status=code;return this;},json(body){result.body=body;return this;}};
      await guard(req,res,()=>{result.next++;});
      return {...result,principal:req.authUser};
    }
    assert.equal((await invoke({})).status,401);
    assert.equal(calls,0,'No token must not call auth');
    const accepted=await invoke();
    assert.equal(accepted.next,1);
    assert.equal(accepted.principal.id,42);
    response={ok:false,status:401};
    assert.equal((await invoke()).status,401);
    response={ok:false,status:500};
    assert.equal((await invoke()).status,503);
    response=new Error('Connection refused');
    const offline=await invoke();
    assert.equal(offline.status,503);
    assert.equal(offline.next,0);
    response={ok:true,json:async()=>({data:{id:'untrusted',roles:['ADMIN']}})};
    assert.equal((await invoke()).status,503);
    response={ok:true,json:async()=>({data:{id:42,roles:[]}})};
    const customer=await invoke();
    assert.equal(name==='admin'?customer.status:customer.next,name==='admin'?403:1);
    fetchMock.mock.restore();
  });
}
