# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting on this repository, or contact the maintainer through the GitHub profile listed on the repository page. Include:

- affected version / commit;
- platform and Node.js / Git versions;
- a minimal reproduction;
- impact and any suggested mitigation.

You should receive an acknowledgement within a few days.

## Security model

GitDeck's HTTP service is designed for local use:

- the HTTP server binds to `127.0.0.1`;
- there is no authentication layer;
- any process on the same machine that can reach the loopback port can call the API;
- do **not** expose the port to a LAN or the public internet;
- GitDeck does not read or store Git credentials; Git credential handling remains with the system Git installation;
- no telemetry or cloud sync is performed.

Repository paths are stored in `.data/state.json`.
