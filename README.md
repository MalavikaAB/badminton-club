# Club Night

A web-based badminton club night board and organiser tool.

## Planned stack

- Java 21 and Spring Boot backend
- Next.js frontend
- PostgreSQL persistence
- Scheduler domain module independent from the web layer

## First slice

The initial project includes a scheduler domain model and a small simulator target. The scheduler creates six courts from a configurable format template and keeps players who are not selected in a waiting list.

## Project layout

- `backend/` Spring Boot API and scheduler domain
- `frontend/` board and organiser web client (to be added)
