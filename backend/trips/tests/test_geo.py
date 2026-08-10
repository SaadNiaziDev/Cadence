from django.test import SimpleTestCase

from trips.services import geo


class DistanceTests(SimpleTestCase):
    def test_haversine_matches_a_known_distance(self):
        # New York to Los Angeles is about 2,450 great-circle miles.
        miles = geo.haversine_miles(40.7128, -74.0060, 34.0522, -118.2437)
        self.assertAlmostEqual(miles, 2450, delta=15)

    def test_cumulative_distance_grows_monotonically(self):
        line = [(-87.6, 41.8), (-86.1, 39.7), (-83.0, 40.0)]
        totals = geo.cumulative_miles(line)
        self.assertEqual(totals[0], 0.0)
        self.assertLess(totals[0], totals[1])
        self.assertLess(totals[1], totals[2])


class PositionTests(SimpleTestCase):
    def setUp(self):
        # A due-north line, which makes the expected midpoint obvious.
        self.line = [(-90.0, 40.0), (-90.0, 41.0)]
        self.cumulative = geo.cumulative_miles(self.line)

    def test_start_and_end_are_returned_exactly(self):
        self.assertEqual(geo.position_at_miles(self.line, self.cumulative, 0), self.line[0])
        self.assertEqual(geo.position_at_miles(self.line, self.cumulative, 10_000), self.line[-1])

    def test_a_point_between_vertices_is_interpolated(self):
        half = self.cumulative[-1] / 2
        longitude, latitude = geo.position_at_miles(self.line, self.cumulative, half)
        self.assertAlmostEqual(longitude, -90.0)
        self.assertAlmostEqual(latitude, 40.5, places=3)

    def test_interpolation_lands_on_the_right_segment_of_a_long_line(self):
        line = [(0.0, 0.0), (0.0, 1.0), (0.0, 2.0), (0.0, 3.0)]
        cumulative = geo.cumulative_miles(line)
        _, latitude = geo.position_at_miles(line, cumulative, cumulative[-1] * 0.75)
        self.assertAlmostEqual(latitude, 2.25, places=2)

    def test_an_empty_geometry_does_not_raise(self):
        self.assertEqual(geo.position_at_miles([], [], 5), (0.0, 0.0))


class SimplifyTests(SimpleTestCase):
    def test_short_lines_are_returned_untouched(self):
        line = [(0.0, 0.0), (1.0, 1.0)]
        self.assertEqual(geo.simplify(line), line)

    def test_collinear_points_are_removed(self):
        line = [(0.0, 0.0), (0.0, 0.5), (0.0, 1.0), (0.0, 1.5), (0.0, 2.0)]
        self.assertEqual(geo.simplify(line), [(0.0, 0.0), (0.0, 2.0)])

    def test_endpoints_always_survive(self):
        line = [(i * 0.001, (i % 3) * 0.0001) for i in range(500)]
        simplified = geo.simplify(line)
        self.assertEqual(simplified[0], line[0])
        self.assertEqual(simplified[-1], line[-1])

    def test_a_meaningful_bend_is_preserved(self):
        line = [(0.0, 0.0), (0.5, 0.5), (1.0, 0.0)]
        self.assertEqual(len(geo.simplify(line)), 3)

    def test_dense_lines_shrink_substantially(self):
        # A gently curving line with far more detail than any map needs.
        line = [(i * 0.0005, (i * 0.0005) ** 2) for i in range(4000)]
        self.assertLess(len(geo.simplify(line)), len(line) // 4)

    def test_simplification_does_not_recurse_into_a_stack_overflow(self):
        # Built with an explicit stack precisely so a long jagged line cannot blow up.
        line = [(i * 0.0001, 0.01 if i % 2 else -0.01) for i in range(20_000)]
        self.assertGreater(len(geo.simplify(line)), 2)

    def test_a_pathological_line_is_thinned_before_simplifying(self):
        # Every vertex is a local extreme, which is the worst case for the algorithm.
        # Thinning the input first is what keeps this bounded instead of quadratic.
        line = [(i * 0.0001, 0.01 if i % 2 else -0.01) for i in range(20_000)]
        self.assertLessEqual(len(geo.simplify(line)), geo._MAX_INPUT_VERTICES + 1)

    def test_thinning_keeps_both_endpoints(self):
        line = [(i * 0.001, 0.0) for i in range(10_000)]
        thinned = geo._thin(line, 100)
        self.assertEqual(thinned[0], line[0])
        self.assertEqual(thinned[-1], line[-1])
        self.assertLessEqual(len(thinned), 101)
