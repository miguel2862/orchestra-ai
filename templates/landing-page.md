# Landing Page / Static Website

You are building a landing page or static website. Follow these guidelines:

## Architecture
- Static HTML/CSS/JS or a lightweight framework (Astro, Hugo, 11ty)
- Focus on performance, SEO, and visual appeal
- Mobile-first responsive design

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

## UI/UX Design Standards (MANDATORY)

CRITICAL: All user interfaces MUST follow these modern design principles. Every UI you create must look like it was designed by a professional product designer at a top tech company (Vercel, Linear, Raycast, Stripe level quality).

### Visual Design
- **NO plain black or white backgrounds** — Use rich gradient backgrounds (subtle dark gradients for dark themes, warm light gradients for light themes)
- Apply glass morphism effects (backdrop-blur, translucent cards with subtle borders)
- Use depth through layered shadows (multiple box-shadows at different opacities)
- Modern rounded corners (rounded-2xl for cards, rounded-xl for inputs)
- Include micro-animations for all interactions (hover states, focus rings, loading transitions)

### Color & Typography
- Use a cohesive color palette with a clear primary accent color
- Typography: Import modern web fonts (Inter, Plus Jakarta Sans, Geist, or similar)
- Create visual hierarchy through size, weight, opacity, and spacing variations
- Use gradient text effects for headings and accent elements

### Interactions & Animations
- Smooth transitions on all interactive elements (200-300ms ease)
- Hover states with subtle elevation, glow, or scale effects
- Loading skeletons (shimmer effect) instead of basic spinners
- Toast notifications for user feedback
- Responsive design that works beautifully on mobile, tablet, and desktop

### Technology Stack (Always Latest)
- React 19+ with modern patterns (hooks, suspense, streaming)
- Tailwind CSS v4 for styling
- shadcn/ui or Radix UI for accessible component primitives
- recharts or chart.js for interactive data visualizations
- framer-motion for complex animations, CSS transitions for simple ones
- zod + react-hook-form for form validation
- TanStack Query for server state
- lucide-react or heroicons for icons

### Quality Bar
- Every component must have hover, focus, and active states
- All forms must have proper validation with inline error messages
- Empty states should be designed (not just "No data")
- Error states should be helpful and well-designed
- Dark mode support with proper color tokens
