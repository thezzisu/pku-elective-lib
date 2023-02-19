import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import fastify from 'fastify'
import { Browser, launch } from 'puppeteer-core'
import { Config, configSchema, dumpConfig, loadConfig } from './config.js'
import { Session } from './session.js'

const server = fastify().withTypeProvider<TypeBoxTypeProvider>()

declare module 'fastify' {
  interface FastifyInstance {
    config: Config
    browser: Browser | null
    sessions: Record<string, Session>
  }
}

server.decorate('config', loadConfig())
server.decorate('browser', null)
server.decorate('sessions', Object.create(null))

server.get('/config', async (req) => {
  return server.config
})

server.post('/config', { schema: { body: configSchema } }, async (req) => {
  dumpConfig((server.config = req.body))
  return 0
})

server.post('/start', async (req) => {
  if (server.browser) throw new Error('Already started')
  if (!server.config.browserPath) throw new Error('Browser path is not set')
  server.browser = await launch({
    executablePath: server.config.browserPath,
    headless: server.config.headless
  })
  return 0
})

server.post('/stop', async (req) => {
  if (!server.browser) throw new Error('Not started')
  await server.browser.close()
  server.browser = null
  return 0
})

server.get('/session', async (req) => {
  return Object.keys(server.sessions)
})

server.post('/session', async (req) => {
  if (!server.browser) throw new Error('Not started')
  const session = new Session(server.browser)
  await session.init()
  server.sessions[session.name] = session
  return session.name
})

server.get(
  '/session/:id',
  { schema: { params: Type.Object({ id: Type.String() }) } },
  async (req) => {
    const session = server.sessions[req.params.id]
    if (!session) throw new Error('Not found')
    return session.name
  }
)

server.post(
  '/session/:id/login',
  {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({
        user: Type.String(),
        pass: Type.String(),
        secondary: Type.Optional(Type.Boolean())
      })
    }
  },
  async (req) => {
    const session = server.sessions[req.params.id]
    if (!session) throw new Error('Not found')
    await session.login(req.body.user, req.body.pass, req.body.secondary)
    return 0
  }
)

server.post(
  '/session/:id/loadList',
  {
    schema: {
      params: Type.Object({ id: Type.String() })
    }
  },
  async (req) => {
    const session = server.sessions[req.params.id]
    if (!session) throw new Error('Not found')
    return session.loadList()
  }
)

server.post(
  '/session/:id/refreshLimit',
  {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({
        index: Type.String(),
        seqNo: Type.String(),
        xh: Type.String()
      })
    }
  },
  async (req) => {
    const session = server.sessions[req.params.id]
    if (!session) throw new Error('Not found')
    return session.refreshLimit(req.body.index, req.body.seqNo, req.body.xh)
  }
)

server.post(
  '/session/:id/loadCaptcha',
  {
    schema: {
      params: Type.Object({ id: Type.String() })
    }
  },
  async (req) => {
    const session = server.sessions[req.params.id]
    if (!session) throw new Error('Not found')
    return session.loadCaptcha()
  }
)

server.post(
  '/session/:id/elect',
  {
    schema: {
      params: Type.Object({ id: Type.String() }),
      body: Type.Object({
        elecUrl: Type.String(),
        xh: Type.String(),
        code: Type.String()
      })
    }
  },
  async (req) => {
    const session = server.sessions[req.params.id]
    if (!session) throw new Error('Not found')
    return session.elect(req.body.elecUrl, req.body.xh, req.body.code)
  }
)

server.delete(
  '/session/:id',
  {
    schema: {
      params: Type.Object({ id: Type.String() })
    }
  },
  async (req) => {
    const session = server.sessions[req.params.id]
    if (!session) throw new Error('Not found')
    await session.destroy()
    delete server.sessions[req.params.id]
    return 0
  }
)

export { server }
