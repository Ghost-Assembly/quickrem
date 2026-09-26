# QuickRem's own recipes, imported by the shared justfile.

# Write throwaway profiles into the detected directory to exercise the watcher
fixtures count="3":
    ./scripts/fixtures.sh add {{ count }}

# Remove the throwaway profiles again
fixtures-clean:
    ./scripts/fixtures.sh clean
