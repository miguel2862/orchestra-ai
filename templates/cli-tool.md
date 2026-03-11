# CLI Tool

You are building a command-line tool. Follow these guidelines:

## Architecture
- Clear command structure with subcommands if needed
- Proper argument parsing and validation
- Helpful error messages and usage info
- Cross-platform compatibility (macOS, Windows, Linux)

## Steps
1. **Command Design**: Define the CLI interface — commands, flags, arguments
2. **Project Setup**: Initialize with proper structure and entry point
3. **Core Logic**: Implement the main functionality
4. **CLI Layer**: Wire up argument parsing and command routing
5. **Output**: Format output nicely (tables, colors, progress bars)
6. **Error Handling**: User-friendly error messages and exit codes
7. **Testing**: Test all commands and edge cases
8. **Distribution**: Set up bin field, shebang, and npm/pip packaging

## Quality Standards
- Helpful `--help` output for every command
- Proper exit codes (0 for success, 1+ for errors)
- No unhandled promise rejections or uncaught exceptions
- Works on macOS, Windows, and Linux

## Technology Standards (MANDATORY)

### Latest Versions
- Always use the LATEST stable versions of all dependencies
- TypeScript strict mode, ES2023+ features

### CLI UX
- Beautiful terminal output with colors (chalk/kleur) and spinners (ora)
- Clear help text with examples
- Proper exit codes
- Progress indicators for long operations
- Interactive prompts where appropriate (@inquirer/prompts)

### Code Quality
- Comprehensive argument parsing (commander, yargs, or citty)
- Proper error messages (not raw stack traces)
- Cross-platform compatibility (Windows/macOS/Linux)
- Unit tests for core logic
