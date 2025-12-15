import sys
import os

# Add the project directory to sys.path
sys.path.append(os.getcwd())

try:
    print("Importing main...")
    import main
    print("Successfully imported main.")

    print("Importing analyzer...")
    import analyzer
    print("Successfully imported analyzer.")

    print("Checking CacheManager...")
    cm = main.CacheManager()
    print("CacheManager instantiated successfully.")

    print("Checking analyze_papers signature...")
    # Just checking if we can call it with dummy args (it will fail inside but we want to see if it starts)
    try:
        analyzer.analyze_papers({}, {}, None, [], None, None, None)
    except Exception as e:
        print(f"Caught expected exception during dummy call (this is fine as long as it's not a SyntaxError): {e}")

    print("Verification script finished successfully.")

except ImportError as e:
    print(f"ImportError: {e}")
    sys.exit(1)
except SyntaxError as e:
    print(f"SyntaxError: {e}")
    sys.exit(1)
except Exception as e:
    print(f"An error occurred: {e}")
    sys.exit(1)
