# Full-Stack Application

You are building a complete full-stack web application.

## Architecture
- Modern frontend framework (React, Next.js, Vue, etc.) as specified
- Backend with API routes and proper data layer
- Clear separation of concerns: pages, components, API, data

## Steps
1. **API & Data Design**: Define endpoints, data models, and database schema
2. **Project Setup**: Scaffold the project with chosen framework, install dependencies
3. **Backend Implementation**: Build API routes, middleware, data access layer
4. **Frontend Setup**: Create layout, routing, shared components, and theme
5. **Feature Implementation**: Build each feature end-to-end (API + UI)
6. **Integration**: Wire frontend to backend, handle auth flows, real-time updates
7. **Testing**: Write unit and integration tests, verify all endpoints and pages
8. **Deployment**: Configure build scripts, environment variables, Docker/CI if needed

## Quality Standards
- Type-safe code (TypeScript preferred, strict mode)
- Proper error handling on both frontend and backend
- Responsive design across mobile, tablet, and desktop
- Clean, readable code with consistent patterns
- Input validation on all API endpoints
- Consistent error response format across the API

## UI/UX
- Professional, modern design with strong visual hierarchy
- Cohesive color palette, modern typography, appropriate spacing
- Loading, error, and empty states must all look intentional
- Interactive elements need hover/focus states and smooth transitions
- Responsive layouts that adapt gracefully across breakpoints

## Tools Available
- Shell: `mcp__desktop-commander__*` tools for running commands
- Browser: `mcp__playwright__*` tools for visual testing

## SUCCESS CRITERIA
- All API endpoints return correct responses with proper status codes
- Frontend renders without console errors on all routes
- App starts successfully with a single command
- All forms validate input and show meaningful errors
- Responsive layout works at 375px, 768px, and 1280px viewports
- No TypeScript errors (`tsc --noEmit` passes)
