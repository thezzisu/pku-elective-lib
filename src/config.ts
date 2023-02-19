import { Static, Type } from '@sinclair/typebox'
import fs from 'fs-extra'
import { homedir } from 'os'
import { join } from 'path'

const configDir = join(homedir(), '.elective')
fs.ensureDirSync(configDir)
const configPath = join(configDir, 'config.json')

export const configSchema = Type.Object({
  browserPath: Type.String(),
  headless: Type.Optional(Type.Boolean())
})
export type Config = Static<typeof configSchema>

export function loadConfig(): Config {
  if (!fs.existsSync(configPath)) {
    return {
      browserPath: ''
    }
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
}

export function dumpConfig(config: Config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}
