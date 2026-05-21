# Eynis Engineering Principles

## Library and Dependency Policy
- Use actively maintained libraries only.
- Avoid deprecated packages and APIs.
- Prefer stable, widely adopted libraries with clear release cadence.
- Run dependency review before major merges.

## Architecture Quality Bar
Every slice must be reviewed for:
- Efficiency and performance characteristics
- Security posture and tenant isolation
- Operational reliability and failure handling
- Maintainability and code readability
- Scalability of design decisions

## Delivery Discipline
- Build -> test -> self-review -> user validation -> push
- No secrets in code, logs, docs, or chat
- Record decisions and trade-offs in daily context logs
