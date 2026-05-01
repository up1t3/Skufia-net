import sys
import traceback

sys.path.insert(0, '.')
sys.path.insert(0, './backend')

try:
    import tests.backend.unit.test_auth_logic
    print("Success")
except Exception as e:
    traceback.print_exc()
