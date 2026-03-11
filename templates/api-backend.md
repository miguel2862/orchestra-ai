# API / Backend Service

You are building a backend API service. Follow these guidelines:

## Architecture
- RESTful or GraphQL API design as appropriate
- Proper routing, middleware, and error handling
- Database integration if data persistence is needed
- Authentication/authorization if specified

## Steps
1. **API Design**: Define endpoints, request/response schemas, and auth strategy
2. **Project Setup**: Initialize the project with proper structure
3. **Database Layer**: Set up models, migrations, and database connection
4. **Route Implementation**: Build all API endpoints
5. **Middleware**: Add validation, auth, rate limiting, logging
6. **Testing**: Write integration tests for all endpoints
7. **Documentation**: Generate or write API documentation

## Quality Standards
- Consistent error response format
- Input validation on all endpoints
- Proper HTTP status codes
- Environment-based configuration

## Technology Standards (MANDATORY)

### Latest Versions
- Always use the LATEST stable versions of all dependencies
- Use TypeScript strict mode
- Use modern runtime features (ES2023+, top-level await, etc.)

### API Design
- RESTful with proper HTTP methods and status codes, OR GraphQL with proper schema
- Input validation with zod or similar
- Proper error handling with typed error responses
- Rate limiting, CORS, and security headers
- OpenAPI/Swagger documentation if REST

### Testing
- Comprehensive test coverage (unit + integration)
- Use vitest or jest with proper mocking
- Test edge cases, error paths, and validation

### Code Quality
- Clean architecture with clear separation of concerns
- Proper logging (structured, leveled)
- Environment configuration with type-safe env parsing
- Database migrations if applicable
