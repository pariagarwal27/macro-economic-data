import sys
from pathlib import Path
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from consensus_research import rolling_weight, paired_interval


class ResearchTests(unittest.TestCase):
    def test_weight_uses_only_prior_observations_and_can_choose_consensus(self):
        prior = pd.DataFrame({'actual': [0., 0., 0.], 'consensus': [0., 0., 0.], 'surprise': [10., 10., 10.]})
        self.assertEqual(rolling_weight(prior, minimum=3), 0.)
        self.assertEqual(rolling_weight(prior.iloc[:2], minimum=3), 0.)

    def test_paired_interval_for_identical_predictions(self):
        result = paired_interval(np.array([1., 2., 3.]), np.array([0., 0., 0.]), np.array([0., 0., 0.]), draws=200)
        self.assertEqual(result['mean_improvement'], 0.)
        self.assertEqual(result['interval_95'], [0., 0.])


if __name__ == '__main__':
    unittest.main()
