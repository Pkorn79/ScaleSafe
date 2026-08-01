# Validation and publishing

## Build gate

- Install dependencies using the project's package manager and lockfile policy.
- Run typechecking, linting, tests, and the production build that apply.
- Treat warnings as review items. Remove warnings introduced by the change.
- Confirm the expected routes and static assets exist in the production output.

## Visual gate

Use browser screenshots when browser control is available.

If browser control is unavailable, mark visual QA blocked or unverified. Do not call source inspection, responsive CSS, a production build, or an HTTP response a visual pass.

Check at least:

- desktop around 1440 by 900;
- mobile around 390 by 844;
- a viewport near major layout breakpoints when the design is complex.

Inspect the first viewport and each critical section. Confirm:

- no horizontal overflow;
- no clipped or overlapping text;
- readable navigation and calls to action;
- stable card, grid, toolbar, and media dimensions;
- visible focus states and adequate contrast;
- useful image crops and loaded assets;
- no browser toolbar or screenshot artifact mistaken for page content.

## Interaction gate

Test the smallest set that proves the workflow:

- primary navigation;
- primary CTA;
- menus and tabs;
- copy controls;
- forms without submitting real data unless approved;
- downloads and public assets;
- expected redirects and 404 behavior.

For downloads, verify status, content type, byte size, archive structure, and checksum when supplied.

## Release gate

Before publishing:

- confirm destination project and production domain;
- confirm the release includes only intended files;
- confirm the working build is the build being uploaded;
- preserve the previous deployment or rollback path;
- obtain approval for the external production action.

After publishing:

- verify the custom domain rather than only a provider preview URL;
- verify the page title and unique release content;
- test public downloads or critical assets from the live domain;
- compare hashes when integrity matters;
- report the commit and deployment result without credentials.

Use `ready`, `blocked`, and `unverified` precisely. Never convert a missing tool or inaccessible surface into a pass.
