# s3fetch

This Worker is adapted from the [aws4fetch](https://github.com/mhart/aws4fetch) library. It aims to be the simplest possible solution for authenticating requests to S3 buckets from Cloudflare Workers using [AWS Signature Version 4](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html)


[Quickstart](#quickstart) •  [Cache](#quickstart) • [Advanced](#advanced)

### Supports
- Range requests
- Conditional requests (e.g. `if-none-match`)
- CORS preflight requests
  

- - - 

### Quickstart <a name="quickstart"></a>
1. Get your security credentials from AWS here: https://console.aws.amazon.com/iam/home?#/security_credentials. You'll need the access key ID and secret access key
2. Go to https://dash.cloudflare.com/workers/view, select `Create a Worker` and name it
3. Paste the contents of [index.js](/index.js) in the Worker body, then press `Save and Deploy`
4. Press the back arrow and add the following environment variables (4 total):
`ACCESS_KEY_ID [🔒 Encrypt]`, `SECRET_ACCESS_KEY [🔒 Encrypt]`, `S3_BUCKET_NAME`, and `S3_REGION`
> For bucket name and region, here are three examples. In all cases - so long  as the client requests `/20806827090258869800702155681/IMG_8799.jpg` - the signature will be valid:
   
```bash
# https://{BUCKET_NAME}.s3.{S3_REGION}.amazonaws.com/20806827090258869800702155681/IMG_8799.jpg
# https://s3-{S3_REGION}.amazonaws.com/{S3_BUCKET_NAME}/20806827090258869800702155681/IMG_8799.jpg
# https:/s3.{S3_REGION}.amazonaws.com/{S3_BUCKET_NAME}/20806827090258869800702155681/IMG_8799.jpg
# https://s3.amazonaws.com/{S3_BUCKET_NAME}/20806827090258869800702155681/IMG_8799.jpg (us-east-1 only)
```
5. When you're done, this is what your configuration should look like:
![finished.png](https://storage.franktaylor.io/d06cef5527f329e519553f649b3a76e219f2c9d6/CleanShot%202020-03-30%20at%2004.24.39@2x.png)
6. Finally, add a route under the **zone/subdomain** that you want to listen on for client requests, like `https://api.cflr.example.com/*` and apply the Worker you just created:
![route.png](https://storage.franktaylor.io/d06cef5527f329e519553f649b3a76e219f2c9d6/CleanShot%202020-03-30%20at%2004.29.31@2x.png)


### Cache <a name=“cache”></a>
This Worker does not specify any cache settings. Please refer to [Cloudflare's general cache documentation](https://support.cloudflare.com/hc/en-us/articles/202775670), the [Cache API](https://developers.cloudflare.com/workers/about/using-cache/#body-inner) or the Advanced Configuration section below.

### Advanced  <a name=“advanced”></a>
> Note: if you have a more complex workflows or need to sign requests for other AWS services, please use [aws4fetch](https://github.com/mhart/aws4fetch), from which this Worker is adapted.

```js
/* Default fetch event handler */
addEventListener('fetch', event => event.respondWith(handle(event.request)))

async function handle (request) {
  if (request.method === 'OPTIONS') {
    return new Response('', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS,POST',
        'Access-Control-Max-Age': 86400
      }
    })
  }

  /** Sign the request, preserve the headers and the request body
   * This is the recommended method
   * @returns a Request object
   */
  let signedRequest = await aws.sign(request)

  return fetch(signedRequest)
}
```

```js
/* Sign the request URL only */

/**
 * You can just pass the request URL for signing. Note that you cannot
 * pass a second parameter to fetch(), as AWS will only accept headers that
 * are ordered in a specific way.
 * @returns a Request object
 */
let signedRequest = await aws.sign(request.url)



/* Cache subrequest using the cf options object */
async function handle (request) {
  //..
  let signedRequest = await aws.sign(request)

  return fetch(signedRequest, {
    cf: {
      cacheTtl: 3600, // all plans
      cacheTtlByStatus: { // option is only available for Enterprise customers
        "200-299": 86400,
        "404": 1,
        "500-599": 0
      }
    }
  })
}

```
