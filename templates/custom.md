# Custom Project

You are building a custom project based entirely on the user's specifications.

## Approach
1. **Analyze Requirements**: Carefully read the business need and technical approach
2. **Architecture**: Design the best architecture for the described use case
3. **Implementation**: Build the project step by step
4. **Testing**: Verify the implementation works as described
5. **Polish**: Clean up, add error handling, and ensure quality

## Quality Standards
- Follow the user's specified tech stack and constraints
- Write clean, maintainable code
- Include proper error handling
- Document any non-obvious decisions

## UI/UX Design Standards (IF YOUR PROJECT INCLUDES A WEB UI)

The following standards apply only if your custom project includes a web-based user interface. For CLI tools, APIs, data pipelines, or other non-UI projects, skip this section.

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

## Tools Available
- Shell: `mcp__desktop-commander__*` tools for running commands
- Browser: `mcp__playwright__*` tools for visual testing

## SUCCESS CRITERIA
- All deliverables match the project specification
- Code is clean, well-commented, and follows best practices
- All tests pass
- Project starts and runs without errors
- Documentation is clear and comprehensive
