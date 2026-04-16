use geo::{Coord, CoordNum};

const EQUATORIAL_RADIUS: f64 = 6378137.0;
const POLAR_RADIUS: f64 = 6356752.3;
const E_SQUARED: f64 =
    1.0 - (POLAR_RADIUS * POLAR_RADIUS) / (EQUATORIAL_RADIUS * EQUATORIAL_RADIUS);

fn prime_vertical_radius(lat: f64) -> f64 {
    let s = lat.sin();
    EQUATORIAL_RADIUS / (1.0 - E_SQUARED * s * s).sqrt()
}

#[derive(Eq, PartialEq, Clone, Copy, Hash, Default, Debug)]
pub struct Coord3d<T: CoordNum = f64> {
    pub x: T,
    pub y: T,
    pub z: T,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct AffineTransform3d<T: CoordNum = f64>([[T; 3]; 3]);
impl<T: CoordNum> AffineTransform3d<T> {
    pub fn apply3d(&self, coord: Coord3d<T>) -> Coord3d<T> {
        Coord3d {
            x: (self.0[0][0] * coord.x + self.0[0][1] * coord.y + self.0[0][2] * coord.z),
            y: (self.0[1][0] * coord.x + self.0[1][1] * coord.y + self.0[1][2] * coord.z),
            z: (self.0[2][0] * coord.x + self.0[2][1] * coord.y + self.0[2][2] * coord.z),
        }
    }
    pub fn transposed(&self) -> Self {
        Self([
            [self.0[0][0], self.0[1][0], self.0[2][0]],
            [self.0[0][1], self.0[1][1], self.0[2][1]],
            [self.0[0][2], self.0[1][2], self.0[2][2]],
        ])
    }
}

pub fn geo_to_ecef(geo: Coord) -> Coord3d {
    let l = geo.x.to_radians();
    let t = geo.y.to_radians();
    let ct = t.cos();
    let n = prime_vertical_radius(t);
    Coord3d {
        x: n * ct * l.cos(),
        y: n * ct * l.sin(),
        z: (((POLAR_RADIUS * POLAR_RADIUS) / (EQUATORIAL_RADIUS * EQUATORIAL_RADIUS)) * n)
            * t.sin(),
    }
}

pub fn geo_ref_ecef_mat(ref_geo: Coord) -> (Coord3d, AffineTransform3d) {
    let ref_ecef = geo_to_ecef(ref_geo);

    let l = ref_geo.x.to_radians();
    let t = ref_geo.y.to_radians();
    let (sl, cl) = l.sin_cos();
    let (st, ct) = t.sin_cos();
    #[rustfmt::skip]
    let ecef_mat = AffineTransform3d([
        [-sl,        cl, 0.0],
        [-st*cl, -st*sl,  ct],
        [ ct*cl,  ct*sl,  st]
    ]);

    (ref_ecef, ecef_mat)
}

pub fn geo_to_enu(point_ecef: Coord, ref_ecef: Coord3d, ecef_mat: AffineTransform3d) -> Coord3d {
    let point_ecef = geo_to_ecef(point_ecef);
    let vec = Coord3d {
        x: point_ecef.x - ref_ecef.x,
        y: point_ecef.y - ref_ecef.y,
        z: point_ecef.z - ref_ecef.z,
    };
    ecef_mat.apply3d(vec)
}

pub fn ecef_to_geo(ecef: Coord3d) -> Coord {
    let r = (ecef.x * ecef.x + ecef.y * ecef.y).sqrt();
    let ep2 = (EQUATORIAL_RADIUS * EQUATORIAL_RADIUS - POLAR_RADIUS * POLAR_RADIUS)
        / (POLAR_RADIUS * POLAR_RADIUS);
    let F = 54.0 * POLAR_RADIUS * POLAR_RADIUS * ecef.z * ecef.z;
    let G = r * r + (1.0 - E_SQUARED) * ecef.z * ecef.z
        - E_SQUARED * (EQUATORIAL_RADIUS * EQUATORIAL_RADIUS - POLAR_RADIUS * POLAR_RADIUS);
    let c = (E_SQUARED * E_SQUARED * F * r * r) / (G * G * G);
    let s = (1.0 + c + (c * c + 2.0 * c).sqrt()).cbrt();
    let P = F / (3.0 * (s + 1.0 / s + 1.0).powf(2.0) * G * G);
    let Q = (1.0 + 2.0 * E_SQUARED.sqrt().powf(4.0) * P).sqrt();
    let r0 = -(P * E_SQUARED * r) / (1.0 + Q)
        + (0.5 * EQUATORIAL_RADIUS * EQUATORIAL_RADIUS * (1.0 + 1.0 / Q)
            - (P * (1.0 - E_SQUARED) * ecef.z * ecef.z) / (Q * (1.0 + Q))
            - 0.5 * P * r * r)
            .sqrt();
    //let U = ((r - E_SQUARED * r0).powf(2.0) + ecef.z * ecef.z).sqrt();
    let V = ((r - E_SQUARED * r0).powf(2.0) + (1.0 - E_SQUARED) * ecef.z * ecef.z).sqrt();
    let z0 = (POLAR_RADIUS * POLAR_RADIUS * ecef.z) / (EQUATORIAL_RADIUS * V);
    Coord {
        x: ecef.y.atan2(ecef.x).to_degrees(),
        y: ((ecef.z + ep2 * z0) / r).atan().to_degrees(),
    }
}

pub fn enu_to_geo(point_enu: Coord3d, ref_ecef: Coord3d, geo_mat: AffineTransform3d) -> Coord {
    // geo_mat = ecef_mat.transposed()
    let v = geo_mat.apply3d(point_enu);
    let point_ecef = Coord3d {
        x: v.x + ref_ecef.x,
        y: v.y + ref_ecef.y,
        z: v.z + ref_ecef.z,
    };
    ecef_to_geo(point_ecef)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ecef() {
        let home_geo = Coord {
            x: -122.05211469338656,
            y: 37.39572903483493,
        };

        let home_ecef = geo_to_ecef(home_geo);
        let epsilon = 0.015;
        assert!((home_ecef.x - -2692426.658).abs() < epsilon);
        assert!((home_ecef.y - -4300075.106).abs() < epsilon);
        assert!((home_ecef.z - 3852376.514).abs() < epsilon);

        let home_geo_2 = ecef_to_geo(home_ecef);
        assert!((home_geo_2.x - home_geo.x).abs() < (std::f32::EPSILON as f64));
        assert!((home_geo_2.y - home_geo.y).abs() < (std::f32::EPSILON as f64));
    }
}
