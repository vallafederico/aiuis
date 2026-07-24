import { McpAgent } from "agents/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Env } from "../index.js"
import { registerDiscoveryTools } from "./tools/discovery.js"
import { registerReadTools } from "./tools/read.js"
import { registerWriteTools } from "./tools/write.js"

export type McpProps = {
  identity: {
    principal: string
    kind: string
    audience: string
    capabilities: unknown
    session: string
  }
}

export class CmsMcpAgent extends McpAgent<Env, unknown, McpProps> {
  server = new McpServer({ name: "aiuis-cms", version: "0.1.0" })

  async fetch(req: Request): Promise<Response> {
    // Extract identity from forwarded header (set by Hono auth gate)
    const identityJson = req.headers.get("X-Cms-Identity")
    if (identityJson) {
      try {
        const identity = JSON.parse(identityJson) as McpProps["identity"]
        await this.updateProps({ identity })
      } catch {
        // ignore parse errors
      }
    }
    return super.fetch(req)
  }

  async init(): Promise<void> {
    // Tools access identity via this.props at call time (closure over `this`)
    const getIdentity = () => this.props?.identity ?? { principal: "unknown", kind: "agent", session: "anon", audience: "", capabilities: {} }
    registerDiscoveryTools(this.server, this.env, getIdentity)
    registerReadTools(this.server, this.env, getIdentity)
    registerWriteTools(this.server, this.env, getIdentity)
  }
}
