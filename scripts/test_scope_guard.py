import unittest
from scope_guard import allowed, validate
class ScopeTests(unittest.TestCase):
    def test_allowed_prefix(self): self.assertTrue(allowed('frontend/src/ui/App.tsx',['frontend/src/ui/']))
    def test_prefix_collision(self): self.assertFalse(allowed('frontend/src/ui-other/App.tsx',['frontend/src/ui/']))
    def test_exact(self): self.assertFalse(allowed('frontend/package.json.bak',['frontend/package.json']))
    def test_cross_module(self):
        with self.assertRaises(ValueError): validate('feature/voice',['frontend/src/ui/App.tsx'])
    def test_shared_change(self):
        with self.assertRaises(ValueError): validate('feature/document-ai',['scope-policy.json'])
    def test_own_module(self): validate('feature/document-ai',['document_engine/extract.py'])
    def test_unknown(self):
        with self.assertRaises(ValueError): validate('main',[])
    def test_wrong_actor(self):
        with self.assertRaises(ValueError): validate('feature/frontend',[],'invalid-user')
    def test_rename_both_paths(self):
        with self.assertRaises(ValueError): validate('feature/frontend',['frontend/src/ui/old.ts','frontend/src/voice/new.ts'])
if __name__=='__main__': unittest.main()
