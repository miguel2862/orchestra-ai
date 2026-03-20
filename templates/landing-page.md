# Landing Page / Static Website

You are building a landing page or static website. Follow these guidelines:

## Architecture
Choose the approach that fits your project:
- **Static**: HTML/CSS/JS, Astro, Hugo, or 11ty — best for content-focused pages targeting Lighthouse 95+
- **Interactive**: React 19+ with Tailwind CSS — best for pages with complex state, animations, or dynamic content

Focus on performance, SEO, and visual appeal regardless of approach.
Mobile-first responsive design.

## Steps
1. **Design Planning**: Define the page sections, content hierarchy, and visual style
2. **Project Setup**: Scaffold with the chosen tool
3. **Structure**: Build the HTML structure for all sections
4. **Styling**: Apply responsive styles with animations and visual polish
5. **Content**: Add copy, images, and media placeholders
6. **Interactivity**: Add any JavaScript interactions (forms, animations, modals)
7. **Optimization**: Optimize images, add meta tags, ensure accessibility

## Quality Standards
- Lighthouse score 90+ on all categories
- Mobile-first responsive design
- Semantic HTML
- Fast load times
- Accessible (WCAG 2.1 AA)

## Technology Stack (for Interactive Landing Pages)
If your landing page requires complex interactivity, use:
- React 19+ with modern patterns (hooks, suspense, streaming)
- Tailwind CSS v4 for styling
- shadcn/ui or Radix UI for accessible component primitives
- framer-motion for complex animations, CSS transitions for simple ones
- lucide-react or heroicons for icons

For static landing pages, prefer vanilla HTML/CSS/JS or a lightweight static site generator.

## Tools Available
- Shell: `mcp__desktop-commander__*` tools for running commands
- Browser: `mcp__playwright__*` tools for visual testing

## SUCCESS CRITERIA
- Lighthouse score 90+ on Performance, Accessibility, Best Practices, SEO
- All interactive elements work correctly (forms, modals, animations)
- Page loads in under 3 seconds on 4G
- Responsive layout works at 375px, 768px, and 1280px viewports
- No console errors or warnings in the browser
- All links and CTAs function correctly
