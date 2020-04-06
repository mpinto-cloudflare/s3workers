const encoder = new TextEncoder('utf-8')

let env

try {
  env = {
    'ACCESS_KEY_ID': ACCESS_KEY_ID || '',
    'SECRET_ACCESS_KEY': SECRET_ACCESS_KEY || '',
    'S3_REGION': S3_REGION || 'us-east-1',
    'S3_BUCKET_NAME': S3_BUCKET_NAME || ''
  }
} catch (e) {
  console.log('Variables not yet defined. Check back when setup is complete!')
  env = { ACCESS_KEY_ID: '', SECRET_ACCESS_KEY: '', S3_REGION: '', S3_BUCKET_NAME: '' }
}

class Algo {
  static async hmac (key, string, encoding) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      typeof key === 'string' ? encoder.encode(key) : key,
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      false,
      ['sign']
    )
    const signed = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(string))
    return encoding === 'hex' ? this.buf2hex(signed) : signed
  }

  static async hash (content, encoding) {
    const digest = await crypto.subtle.digest('SHA-256', typeof content === 'string' ? encoder.encode(content) : content)
    return encoding === 'hex' ? this.buf2hex(digest) : digest
  }

  static buf2hex (buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('0' + x.toString(16)).slice(-2)).join('')
  }

  static encodeRfc3986 (urlEncodedStr) {
    return urlEncodedStr.replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  }
}

class AwsClient {
  constructor ({ accessKeyId, secretAccessKey, sessionToken, service, region, cache }) {
    if (accessKeyId == null) throw new TypeError('accessKeyId is a required option')
    if (secretAccessKey == null) throw new TypeError('secretAccessKey is a required option')
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.sessionToken = sessionToken
    this.service = service
    this.region = env.S3_REGION
    this.bucketName = env.S3_BUCKET_NAME
    // this.cache = cache || new Map()
  }

  async sign (input, init) {
    let hdrs = {}
    if (typeof input === 'string') {
      console.log('true')
      input = new URL(input)
    } else if (input instanceof Request) {
      hdrs = new Headers(input.headers)
      const { method, headers, body } = input
      if (init) init = Object.assign({ method, url, headers }, init)
      if (['GET', 'HEAD', 'OPTIONS'].includes(input.method) == null && init.body == null && headers.has('Content-Type')) {
        init.body = body != null && headers.has('X-Amz-Content-Sha256') ? body : await input.clone().arrayBuffer()
      }
      input = new URL(input.url)
    } else {
      return new Response('Runtime error - can only sign URLs or Requests', { status: 400 })
    }
    input.hostname = `${this.bucketName}.s3.${this.region}.amazonaws.com`

    const signer = new AwsV4Signer(Object.assign({ url: input }, init, this, init && init.aws))
    const signed = Object.assign({}, init, await signer.sign())
    delete signed.aws

    if (hdrs instanceof Headers) {
      for (const [k, v] of hdrs.entries()) {
        signed.headers.append(k, v)
      }
    }

    return new Request(signed.url, signed)
  }
}

class AwsV4Signer {
  constructor ({ method, url, headers, body, accessKeyId, secretAccessKey, sessionToken, service, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
    if (url == null) throw new TypeError('url is a required option')
    if (accessKeyId == null) throw new TypeError('accessKeyId is a required option')
    if (secretAccessKey == null) throw new TypeError('secretAccessKey is a required option')

    this.method = method || (body ? 'POST' : 'GET')
    this.url = new URL(url)
    this.headers = new Headers(headers)
    this.body = body
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.sessionToken = sessionToken
    this.service = 's3'
    this.region = env.S3_REGION
    this.cache = cache || new Map()
    this.datetime = datetime || new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    this.signQuery = signQuery
    this.appendSessionToken = appendSessionToken

    this.headers.delete('Host') // Can't be set in insecure env anyway

    const params = this.signQuery ? this.url.searchParams : this.headers
    if (this.service === 's3' && !this.headers.has('X-Amz-Content-Sha256')) {
      this.headers.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD')
    }

    params.set('X-Amz-Date', this.datetime)
    if (this.sessionToken && !this.appendSessionToken) {
      params.set('X-Amz-Security-Token', this.sessionToken)
    }

    // headers are always lowercase in keys()
    this.signableHeaders = ['host', ...this.headers.keys()]
      .filter(header => allHeaders || !this.unsignableHeaders.includes(header))
      .sort()

    this.signedHeaders = this.signableHeaders.join(';')

    // headers are always trimmed:
    // https://fetch.spec.whatwg.org/#concept-header-value-normalize
    this.canonicalHeaders = this.signableHeaders
      .map(header => header + ':' + (header === 'host' ? this.url.host : this.headers.get(header).replace(/\s+/g, ' ')))
      .join('\n')

    this.credentialString = [this.datetime.slice(0, 8), this.region, this.service, 'aws4_request'].join('/')

    if (this.signQuery) {
      if (this.service === 's3' && !params.has('X-Amz-Expires')) {
        params.set('X-Amz-Expires', 86400) // 24 hours
      }
      params.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
      params.set('X-Amz-Credential', this.accessKeyId + '/' + this.credentialString)
      params.set('X-Amz-SignedHeaders', this.signedHeaders)
    }

    this.encodedPath = decodeURIComponent(this.url.pathname).replace(/\+/g, ' ')

    if (!this.encodedPath) {
      this.encodedPath = this.url.pathname
    }

    if (!singleEncode) {
      this.encodedPath = encodeURIComponent(this.encodedPath).replace(/%2F/g, '/')
    }
    this.encodedPath = Algo.encodeRfc3986(this.encodedPath)

    const seenKeys = new Set()
    this.encodedSearch = [...this.url.searchParams]
      .filter(([k]) => {
        if (!k) return false // no empty keys
        if (this.service === 's3') {
          if (seenKeys.has(k)) return false // first val only for S3
          seenKeys.add(k)
        }
        return true
      })
      .map(pair => pair.map(p => Algo.encodeRfc3986(encodeURIComponent(p))))
      .sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0)
      .map(pair => pair.join('='))
      .join('&')
  }

  get unsignableHeaders () {
    return [
      'authorization',
      'content-type',
      'content-length',
      'user-agent',
      'presigned-expires',
      'expect',
      'x-amzn-trace-id',
      'x-forwarded-proto',
      'range'
    ]
  }

  async sign () {
    if (this.signQuery) {
      this.url.searchParams.set('X-Amz-Signature', await this.signature())
      if (this.sessionToken && this.appendSessionToken) {
        this.url.searchParams.set('X-Amz-Security-Token', this.sessionToken)
      }
    } else {
      this.headers.set('Authorization', await this.authHeader())
    }

    return {
      method: this.method,
      url: this.url,
      headers: this.headers,
      body: this.body
    }
  }

  async authHeader () {
    return [
      'AWS4-HMAC-SHA256 Credential=' + this.accessKeyId + '/' + this.credentialString,
      'SignedHeaders=' + this.signedHeaders,
      'Signature=' + (await this.signature())
    ].join(', ')
  }

  async signature () {
    const date = this.datetime.slice(0, 8)
    const cacheKey = [this.secretAccessKey, date, this.region, this.service].join()
    let kCredentials = this.cache.get(cacheKey)
    if (!kCredentials) {
      const kDate = await Algo.hmac('AWS4' + this.secretAccessKey, date)
      const kRegion = await Algo.hmac(kDate, this.region)
      const kService = await Algo.hmac(kRegion, this.service)
      kCredentials = await Algo.hmac(kService, 'aws4_request')
      this.cache.set(cacheKey, kCredentials)
    }
    return Algo.hmac(kCredentials, await this.stringToSign(), 'hex')
  }

  async stringToSign () {
    return [
      'AWS4-HMAC-SHA256',
      this.datetime,
      this.credentialString,
      await Algo.hash(await this.canonicalString(), 'hex')
    ].join('\n')
  }

  async canonicalString () {
    return [
      this.method,
      this.encodedPath,
      this.encodedSearch,
      this.canonicalHeaders + '\n',
      this.signedHeaders,
      await this.hexBodyHash()
    ].join('\n')
  }

  async hexBodyHash () {
    if (this.headers.has('X-Amz-Content-Sha256')) {
      return this.headers.get('X-Amz-Content-Sha256')
    } else {
      return Algo.hash(this.body || '', 'hex')
    }
  }
}

const aws = new AwsClient({ accessKeyId: env.ACCESS_KEY_ID, secretAccessKey: env.SECRET_ACCESS_KEY })

addEventListener('fetch', event => {
  event.respondWith(handle(event.request))
  event.passThroughOnException()
})

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

  /* Sign the request, preserve the headers and the request body */
  /* This is the recommended method  */
  let signedRequest = await aws.sign(request)

  let response = await fetch(signedRequest)
  if (response.status > 400) {
    response = new Response('Setup not yet complete!')
  }
  return response
}
