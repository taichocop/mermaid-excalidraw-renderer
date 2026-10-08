# Supplemental license texts

Some installed npm packages omit a standalone license file. The notice generator reads fastdom's complete MIT license from its installed README and recognizes names such as fuzzy's LICENSE-MIT. It fails if a newly bundled package has no license source.

Supplemental upstream files checked on 2026-10-08:

- Radix UI primitives packages: https://github.com/radix-ui/primitives/blob/main/LICENSE (MIT, WorkOS). This repository-level license applies to the bundled @radix-ui packages.
- react-remove-scroll-bar 2.3.8: https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE (MIT, Anton Korzunov).

The repository already carries Excalidraw and font licenses separately. Review this mapping whenever dependencies change. The supplemental texts are embedded per package in main.js and THIRD_PARTY_NOTICES.txt.
