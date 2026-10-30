import unittest
import options_chain_update as chain
class TestParser(unittest.TestCase):
 def test_root(self):
  self.assertIsNone(chain.parse_occ('AAPL1261106C00350000','AAPL'))
 def test_date(self):
  self.assertEqual(chain.parse_occ('AAPL301106C00350000','AAPL'),('2030-11-06','call',350.0))
 def test_reject_invalid(self):
  self.assertIsNone(chain.n(float('nan')))
  self.assertIsNone(chain.parse_occ('NONSENSE','AAPL'))
if __name__=='__main__':unittest.main()
