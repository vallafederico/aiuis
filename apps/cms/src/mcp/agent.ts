import { McpAgent } from "agents/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Env } from "../index.js"
import { registerDiscoveryTools } from "./tools/discovery.js"
import { registerReadTools } from "./tools/read.js"
import { registerWriteTools } from "./tools/write.js"
import { registerLifecycleTools } from "./tools/lifecycle.js"
import { registerAssetTools } from "./tools/assets.js"

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

  async init(): Promise<void> {
    // Tools access identity via this.props at call time (closure over `this`)
    const getIdentity = () => this.props?.identity ?? { principal: "unknown", kind: "agent", session: "anon", audience: "", capabilities: {} }
    registerDiscoveryTools(this.server, this.env, getIdentity)
    registerReadTools(this.server, this.env, getIdentity)
    registerWriteTools(this.server, this.env, getIdentity)
    registerLifecycleTools(this.server, this.env, getIdentity)
    registerAssetTools(this.server, this.env, getIdentity)
  }
}
