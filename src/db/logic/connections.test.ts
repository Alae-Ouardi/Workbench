import { describe, expect, it } from "vitest";
import type { Connection, ConnectionsFile } from "../types";
import { displayName, draftConnection, filterGroups, targetChips, targetLine, groupByFolder, nextFreePort, resolveTarget, scriptCommand, searchConnections, sharedClusterContext } from "./connections";

const conn = (id: string, folder: string, env: Connection["env"], client: string, port: number, extra: Partial<Connection> = {}): Connection => ({
  kind: "cluster",
  host: "",
  user: "",
  database: "",
  id,
  folder_id: folder,
  name: "",
  env,
  client,
  local_port: port,
  cluster_domain: "omnevo",
  context: null,
  namespace: null,
  secret: "db-shifteo-services",
  ...extra,
});

const file: ConnectionsFile = {
  folders: [
    { id: "g", name: "Globex" },
    { id: "a", name: "Acme" },
  ],
  connections: [
    conn("1", "a", "prod", "acme", 3308, { context: "prod.euc1.omnevo.cloud" }),
    conn("2", "a", "review", "acme", 3307),
    conn("3", "g", "latest", "globex", 3309),
  ],
  relay_pod: "",
};

describe("db connections", () => {
  it("resolves context and namespace like the connector script", () => {
    expect(resolveTarget(conn("x", "a", "review", "acme", 1))).toEqual({ context: "integration.omnevo.cloud", namespace: "review-acme" });
    expect(resolveTarget(conn("x", "a", "prod", "acme", 1)).context).toBe("prod.acme.omnevo.cloud");
    expect(resolveTarget(file.connections[0]).context).toBe("prod.euc1.omnevo.cloud");
  });

  it("uses the shared cluster only when its context is set", () => {
    const uae = conn("x", "a", "prod", "globex", 3313);
    expect(resolveTarget(uae).context).toBe("prod.globex.omnevo.cloud");
    expect(scriptCommand(uae)).toBe("./omnevo-db-connector.sh prod globex --port 3313 --cluster-domain omnevo");
    const shared = { ...uae, context: sharedClusterContext(uae.cluster_domain) };
    expect(resolveTarget(shared)).toEqual({ context: "prod.euc1.omnevo.cloud", namespace: "prod-globex" });
    expect(scriptCommand(shared)).toBe(
      "./omnevo-db-connector.sh prod globex --port 3313 --cluster-domain omnevo --context prod.euc1.omnevo.cloud",
    );
  });

  it("prints the equivalent script command", () => {
    expect(scriptCommand(file.connections[0])).toBe(
      "./omnevo-db-connector.sh prod acme --port 3308 --cluster-domain omnevo --context prod.euc1.omnevo.cloud",
    );
  });

  it("groups by folder name, environments in order", () => {
    const groups = groupByFolder(file);
    expect(groups.map((g) => g.folder.name)).toEqual(["Acme", "Globex"]);
    expect(groups[0].connections.map((c) => c.env)).toEqual(["review", "prod"]);
  });

  it("searches across folder, env, client and port", () => {
    expect(searchConnections(file, "acme prod").map((c) => c.id)).toEqual(["1"]);
    expect(searchConnections(file, "review acme")[0].id).toBe("2");
    expect(searchConnections(file, "3309").map((c) => c.id)).toEqual(["3"]);
    expect(searchConnections(file, "globex").map((c) => c.id)).toEqual(["3"]);
  });

  it("drafts a connection with the next free port and the folder as client", () => {
    expect(nextFreePort(file)).toBe(3310);
    const draft = draftConnection(file, { id: "n", name: "Initech EU" });
    expect(draft).toMatchObject({ client: "initech-eu", local_port: 3310, env: "review", folder_id: "n" });
  });
});

describe("filterGroups", () => {
  it("keeps every folder for an empty query", () => {
    expect(filterGroups(file, "  ").map((g) => g.folder.name)).toEqual(["Acme", "Globex"]);
  });

  it("keeps only matching connections and drops empty folders", () => {
    const groups = filterGroups(file, "review");
    expect(groups.map((g) => g.folder.name)).toEqual(["Acme"]);
    expect(groups[0].connections.map((c) => c.id)).toEqual(["2"]);
  });

  it("matches a folder name and keeps all its connections", () => {
    expect(filterGroups(file, "acme").flatMap((g) => g.connections.map((c) => c.id))).toEqual(["2", "1"]);
  });

  it("returns nothing when no connection matches", () => {
    expect(filterGroups(file, "nothing-here")).toEqual([]);
  });
});

describe("local connections", () => {
  const local = conn("9", "g", "latest", "", 3306, { kind: "local", host: "127.0.0.1", user: "root", database: "shop" });
  const withLocal: ConnectionsFile = { ...file, connections: [...file.connections, local] };

  it("are named and described by their database", () => {
    expect(displayName(local)).toBe("shop");
    expect(targetLine(local)).toBe("127.0.0.1:3306/shop");
    expect(targetChips(local).map((t) => t.label)).toEqual(["host", "database", "user"]);
  });

  it("are found by 'local', host or database", () => {
    expect(searchConnections(withLocal, "local").map((c) => c.id)).toEqual(["9"]);
    expect(searchConnections(withLocal, "shop").map((c) => c.id)).toEqual(["9"]);
  });

  it("do not take tunnel ports", () => {
    const busy: ConnectionsFile = { ...file, connections: [conn("9", "g", "latest", "", 3310, { kind: "local" })] };
    expect(nextFreePort(busy)).toBe(3307);
  });
});
