# Contributing

Thanks for your interest in `yap`!

A heads-up on what this project is: `yap` is a personal, research-grade language built in spare time. The design is unstable and may change wholesale at any point. That shapes how contributing works here.

> For local development setup, see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Discuss first

**Opening an issue or discussion is far more likely to get a reply than a cold pull request.** Because large parts of the language and compiler can be reworked at any time, please reach out and float an idea before investing in a substantial change — otherwise it may collide with work in flight or a direction the project is moving away from.

Small, self-contained fixes (typos, a contained bug, a focused doc improvement) are happily accepted directly as PRs. Anything larger: discuss it first.

## Code of Conduct

This project follows the [Contributor Covenant code of conduct](./CODE_OF_CONDUCT.md). All participants are expected to follow it.

## Reporting issues

Use the [issue tracker](https://github.com/tiansivive/yap/issues/new/choose) and pick the most appropriate form. For security problems, do not open a public issue — see [SECURITY.md](./SECURITY.md).

## Sending a pull request

- **Keep it single-purpose.** One concern per PR. Multi-purpose PRs are slower to review and harder to merge.
- **Title** follows `[<area>] <Description>` (e.g. `[lowering] Bridge closure bundle ABI`).
- **Description**: explain _why_ the change was needed and the approach — not a restatement of the diff. Keep it tight (the PR template has the shape).
- **Green CI before review.** Run `pnpm lint` and `pnpm test` locally; PRs are squash-merged.
- Mark work-in-progress PRs as **draft**.

If a change touches design that the project tracks in `z-yap/`, mention it — it helps to know which design records a change relates to.
