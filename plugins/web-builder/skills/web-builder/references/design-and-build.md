# Design and build standards

## Match the domain

- Business operations, CRM, SaaS, and support sites should feel quiet, organized, and easy to scan.
- Product, venue, portfolio, and object-focused sites should show the real subject immediately.
- Games and expressive creative experiences may use richer motion and illustration when it helps the experience.

## First viewport

- Make the business, product, person, place, event, or literal offer the primary heading.
- Put value explanation in supporting copy, not an abstract slogan.
- Keep a hint of the next section visible when practical.
- Do not put the main message inside a floating card.
- For a true hero, use a relevant real or generated image or an immersive scene when imagery adds proof. Do not use gradient or SVG decoration as a substitute.

## Layout

- Use full-width page bands with a constrained inner shell.
- Use cards only for repeated items, modals, downloads, and genuinely framed tools.
- Never nest cards.
- Keep card radius at 8px or less unless an existing system says otherwise.
- Define stable grid tracks, aspect ratios, and min/max constraints.
- Never allow text, media, controls, or sticky elements to overlap incoherently.
- Do not scale body or heading type directly with viewport width. Responsive `clamp()` with sensible fixed bounds is acceptable.
- Keep letter spacing at zero unless preserving an established brand system.

## Color and type

- Use a balanced palette with a neutral foundation, a primary color, and at least one purposeful accent.
- Avoid one-note purple, dark-blue, beige, brown, or orange themes unless the brand requires them.
- Meet readable contrast and visible focus requirements.
- Reserve hero-scale type for actual heroes. Use compact headings in panels and cards.

## Controls and icons

- Use icons for familiar actions such as download, copy, menu, close, search, save, and navigation.
- Use the project's icon library, such as Lucide, rather than drawing SVGs by hand.
- Add text when an icon alone would be ambiguous.
- Use tabs for views, segmented controls for modes, toggles for binary settings, sliders or steppers for numeric values, and menus for option sets.

## Content and assets

- Use real names, offers, screenshots, and product states supplied by the user.
- Sanitize private screenshots before publishing.
- Do not use fake customer records, claims, testimonials, or logos as if they were real.
- Use plain copy that names the visitor's task and next action.
- Keep alt text meaningful and concise.

## Implementation

- Follow the existing framework and component model.
- Prefer semantic HTML and progressively enhanced JavaScript.
- Keep dependencies minimal.
- Use structured APIs and parsers for structured content.
- Build expected loading, empty, error, hover, focus, disabled, and success states when the workflow needs them.
- Avoid visible instructions about the interface unless users genuinely need setup or task guidance.
