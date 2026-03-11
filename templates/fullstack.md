# Full-Stack Application

You are building a complete full-stack web application. Follow these guidelines:

## Architecture
- Use a modern frontend framework (React, Next.js, Vue, etc.) as specified by the user
- Set up a proper backend with API routes
- Use a database if data persistence is needed
- Structure the project with clear separation of concerns

## Steps
1. **Architecture Design**: Plan the folder structure, database schema (if any), and API contracts
2. **Backend Setup**: Create the server, routes, middleware, and database models
3. **Frontend Setup**: Scaffold the UI with pages, components, and state management
4. **Integration**: Connect frontend to backend APIs
5. **Styling**: Apply consistent styling with the specified CSS framework
6. **Testing**: Write tests for critical paths
7. **Polish**: Error handling, loading states, responsive design

## Quality Standards
- Type-safe code (TypeScript preferred)
- Proper error handling on both frontend and backend
- Responsive design
- Clean, readable code with consistent patterns

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
