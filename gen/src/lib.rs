use ::geo::{ClosestPoint, Coord, Length, LineLocatePoint, LineString, Point};
use rand::{Rng, SeedableRng};
use rstar::primitives::GeomWithData;
use rstar::{PointDistance, RTree};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::panic;
use wasm_bindgen::prelude::*;
use web_sys::js_sys;
mod geo;
use geo::{enu_to_geo, geo_ref_ecef_mat, geo_to_enu};
mod osm_types;

use crate::geo::{AffineTransform3d, Coord3d};

const DISTANCE_LENIENCY_M: f64 = 0.1;
const COLLECTION_DISTANCE_BASE_M: f64 = 20.0;
const GENERATED_DISTANCE_THRESHOLD_M_2: f64 =
    COLLECTION_DISTANCE_BASE_M * COLLECTION_DISTANCE_BASE_M;

#[wasm_bindgen(start)]
pub fn my_init_function() {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
}

#[wasm_bindgen]
extern "C" {
    #[derive(Clone)]
    pub type OverpassResponse;

    #[wasm_bindgen(structural, method, getter)]
    pub fn elements(this: &OverpassResponse) -> Vec<JsOsmElement>;

    #[derive(Debug)]
    pub type JsOsmElement;
    #[wasm_bindgen(structural, method, getter)]
    pub fn r#type(this: &JsOsmElement) -> String;
    #[wasm_bindgen(structural, method, getter)]
    pub fn id(this: &JsOsmElement) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn tags(this: &JsOsmElement) -> Option<js_sys::Object>;

    #[derive(Debug)]
    #[wasm_bindgen(extends = JsOsmElement)]
    pub type JsOsmNode;
    #[wasm_bindgen(structural, method, getter)]
    pub fn lat(this: &JsOsmNode) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn lon(this: &JsOsmNode) -> f64;

    #[derive(Debug)]
    #[wasm_bindgen(extends = JsOsmElement)]
    pub type JsOsmWay;
    #[wasm_bindgen(structural, method, getter)]
    pub fn nodes(this: &JsOsmWay) -> Vec<f64>;

    pub type GenerateParams;
    #[wasm_bindgen(structural, method, getter)]
    pub fn home(this: &GenerateParams) -> Vec<f64>;
    #[wasm_bindgen(structural, method, getter)]
    pub fn locations(this: &GenerateParams) -> js_sys::Map<js_sys::Number, js_sys::JsString>;
    #[wasm_bindgen(structural, method, getter)]
    pub fn osm(this: &GenerateParams) -> OverpassResponse;
    #[wasm_bindgen(structural, method, getter)]
    pub fn seed_name(this: &GenerateParams) -> String;
    #[wasm_bindgen(structural, method, getter)]
    pub fn slot(this: &GenerateParams) -> f64;
    #[wasm_bindgen(structural, method, getter)]
    pub fn slot_data(this: &GenerateParams) -> APGoSlotData;
    #[wasm_bindgen(structural, method, getter)]
    pub fn subgraph_selection(this: &GenerateParams) -> SubgraphSelection;
    #[wasm_bindgen(structural, method, getter)]
    pub fn team(this: &GenerateParams) -> f64;

    #[derive(Clone)]
    pub type APGoSlotData;
    #[wasm_bindgen(method, getter)]
    pub fn goal(this: &APGoSlotData) -> Goal;
    #[wasm_bindgen(method, getter)]
    pub fn minimum_distance(this: &APGoSlotData) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn maximum_distance(this: &APGoSlotData) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn speed_requirement(this: &APGoSlotData) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn trips(this: &APGoSlotData) -> js_sys::Object;

    pub type Trip;
    #[wasm_bindgen(method, getter)]
    pub fn distance_tier(this: &Trip) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn key_needed(this: &Trip) -> f64;
    #[wasm_bindgen(method, getter)]
    pub fn speed_tier(this: &Trip) -> f64;
}

#[wasm_bindgen]
#[derive(Copy, Clone, Debug)]
pub enum Goal {
    OneHardTravel = 0,
    Allsanity = 1,
    ShortMacGuffin = 2,
    LongMacGuffin = 3,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct Internal {
    pub(crate) points_rtree: Option<RTree<GeomWithData<Point, i64>>>,
    pub(crate) ref_ecef: Option<Coord3d>,
    pub(crate) ecef_mat: Option<AffineTransform3d>,
}

#[wasm_bindgen]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum SubgraphSelection {
    FullGraph,
    BiggestSubgraph,
    ClosestSubgraph,
}

#[derive(Clone)]
struct GeneratorData {
    segments_tree: RTree<GeomWithData<LineString, petgraph::graph::EdgeIndex>>,
    points_tree: RTree<GeomWithData<Point, petgraph::graph::NodeIndex>>,
    graph: petgraph::graph::Graph<Point, f64, petgraph::Undirected>,
}

#[cfg(target_family = "wasm")]
macro_rules! console_log {
    ($($t:tt)*) => (web_sys::console::log_1(&format!($($t)*).into()))
}
#[cfg(not(target_family = "wasm"))]
macro_rules! console_log {
    ($($t:tt)*) => (println!($($t)*))
}

fn distance_tier_to_maximum_distance(
    distance_tier: f64,
    minimum_distance: f64,
    maximum_distance: f64,
) -> f64 {
    let max_dist = (maximum_distance / 10.0) * distance_tier;
    if max_dist < minimum_distance {
        minimum_distance * (1.0 + DISTANCE_LENIENCY_M)
    } else {
        max_dist
    }
}

fn build_trees(
    elements: &[osm_types::Element],
    ref_ecef: &Coord3d,
    ecef_mat: &AffineTransform3d,
) -> GeneratorData {
    console_log!("{} elements", elements.len());
    let coords: HashMap<i64, Coord> = elements
        .iter()
        .filter_map(|el| {
            if let osm_types::Element::Node(node) = el {
                let point_geo = Coord {
                    x: node.lon,
                    y: node.lat,
                };
                let point_enu = geo_to_enu(&point_geo, ref_ecef, ecef_mat);
                Some((node.id.0, (point_enu.x, point_enu.y).into()))
            } else {
                None
            }
        })
        .collect();
    console_log!("{} nodes", coords.len());
    let ways: Vec<Vec<i64>> = elements
        .iter()
        .filter_map(|el| {
            if let osm_types::Element::Way(way) = el {
                Some(way.nodes.iter().map(|r| r.0).collect())
            } else {
                None
            }
        })
        .collect();
    console_log!("{} ways", ways.len());

    let mut node_use_count: HashMap<i64, u32> = HashMap::new();
    for way in &ways {
        for node_id in way {
            node_use_count.insert(*node_id, node_use_count.get(node_id).unwrap_or(&0u32) + 1);
        }
    }

    let mut graph = petgraph::graph::Graph::<Point, f64, petgraph::Undirected>::new_undirected();
    let junction_nodes: HashMap<i64, petgraph::graph::NodeIndex> = node_use_count
        .iter()
        .filter_map(|(node_id, count)| {
            if *count > 1u32 {
                Some((
                    *node_id,
                    graph.add_node(Point::from(*coords.get(node_id).unwrap())),
                ))
            } else {
                None
            }
        })
        .collect();
    drop(node_use_count);
    console_log!("{} junction nodes", junction_nodes.len());

    let mut way_linestrings = Vec::<GeomWithData<LineString, petgraph::graph::EdgeIndex>>::new();
    for way in ways {
        let mut segment_coords: Vec<Coord> = Vec::new();
        let mut first_node = junction_nodes
            .get(way.first().unwrap())
            .copied()
            .unwrap_or_else(|| {
                graph.add_node(Point::from(*coords.get(way.first().unwrap()).unwrap()))
            });
        for osm_node_id in &way {
            if let Some(coord) = coords.get(osm_node_id) {
                segment_coords.push(*coord);
                if let Some(graph_node_id) = junction_nodes.get(osm_node_id) {
                    if segment_coords.len() >= 2 {
                        let segment = LineString::from(segment_coords);
                        let length = ::geo::algorithm::line_measures::Euclidean.length(&segment);
                        way_linestrings.push(GeomWithData::new(
                            segment,
                            graph.add_edge(first_node, *graph_node_id, length),
                        ));
                    }
                    segment_coords = vec![*coord];
                    first_node = *graph_node_id;
                }
            }
        }
        if segment_coords.len() >= 2 {
            let last_node = junction_nodes
                .get(way.last().unwrap())
                .copied()
                .unwrap_or_else(|| {
                    graph.add_node(Point::from(*coords.get(way.last().unwrap()).unwrap()))
                });
            let segment = LineString::from(segment_coords);
            let length = ::geo::algorithm::line_measures::Euclidean.length(&segment);
            way_linestrings.push(GeomWithData::new(
                segment,
                graph.add_edge(first_node, last_node, length),
            ));
        }
    }
    console_log!("{} linestrings", way_linestrings.len());
    console_log!("{} nodes", graph.node_count());
    console_log!("{} edges", graph.edge_count());
    GeneratorData {
        segments_tree: RTree::bulk_load(way_linestrings),
        points_tree: RTree::bulk_load(
            graph
                .node_indices()
                .map(|ni| GeomWithData::new(*graph.node_weight(ni).unwrap(), ni))
                .collect(),
        ),
        graph,
    }
}

pub struct SelectDataInSetFunction<'a, T>
where
    T: Eq + std::cmp::Ord + 'a,
{
    set_to_remove: &'a BTreeSet<T>,
}

impl<'a, T> SelectDataInSetFunction<'a, T>
where
    T: Eq + std::cmp::Ord + 'a,
{
    pub fn new(set_to_remove: &'a BTreeSet<T>) -> Self {
        SelectDataInSetFunction { set_to_remove }
    }
}

impl<T, R> rstar::SelectionFunction<GeomWithData<R, T>> for SelectDataInSetFunction<'_, T>
where
    T: Eq + std::cmp::Ord + std::fmt::Debug,
    R: rstar::RTreeObject + std::fmt::Debug,
{
    fn should_unpack_parent(&self, _: &R::Envelope) -> bool {
        true
    }

    fn should_unpack_leaf(&self, leaf: &GeomWithData<R, T>) -> bool {
        //println!("removing leaf {:?}", leaf.data);
        self.set_to_remove.contains(&leaf.data)
    }
}

fn trim_to_nodes(trees: &mut GeneratorData, retain: &HashSet<petgraph::graph::NodeIndex>) {
    // Need to remove one edge/node at a time so that we can record what the new indices will be

    {
        let remove_edges: BTreeSet<petgraph::graph::EdgeIndex> = trees
            .graph
            .edge_indices()
            .filter(|ei| {
                trees
                    .graph
                    .edge_endpoints(*ei)
                    .is_some_and(|(ni1, ni2)| !retain.contains(&ni1) || !retain.contains(&ni2))
            })
            .collect();
        let mut old_edge_indices: Vec<petgraph::graph::EdgeIndex> =
            trees.graph.edge_indices().collect();
        for ei_to_remove in remove_edges.iter().rev() {
            old_edge_indices.remove(ei_to_remove.index());
            trees.graph.remove_edge(*ei_to_remove);
        }
        let new_edge_indices: HashMap<petgraph::graph::EdgeIndex, petgraph::graph::EdgeIndex> =
            std::iter::zip(old_edge_indices, trees.graph.edge_indices()).collect();
        for _ in trees
            .segments_tree
            .drain_with_selection_function(SelectDataInSetFunction::new(&remove_edges))
        {}
        for leaf in trees.segments_tree.iter_mut() {
            if let Some(new_index) = new_edge_indices.get(&leaf.data) {
                //println!("moving edge index {:?} to {:?}", leaf.data, new_index);
                leaf.data = *new_index;
            }
        }
    }
    {
        let remove_nodes: BTreeSet<petgraph::graph::NodeIndex> = trees
            .graph
            .node_indices()
            .filter(|ni| !retain.contains(ni))
            .collect();
        let mut old_node_indices: Vec<petgraph::graph::NodeIndex> =
            trees.graph.node_indices().collect();
        for ni_to_remove in remove_nodes.iter().rev() {
            old_node_indices.remove(ni_to_remove.index());
            trees.graph.remove_node(*ni_to_remove);
        }
        let new_node_indices: HashMap<petgraph::graph::NodeIndex, petgraph::graph::NodeIndex> =
            std::iter::zip(old_node_indices, trees.graph.node_indices()).collect();
        for _ in trees
            .points_tree
            .drain_with_selection_function(SelectDataInSetFunction::new(&remove_nodes))
        {}
        for leaf in trees.points_tree.iter_mut() {
            if let Some(new_index) = new_node_indices.get(&leaf.data) {
                //println!("moving node index {:?} to {:?}", leaf.data, new_index);
                leaf.data = *new_index;
            }
        }
    }
}

fn trim_to_biggest_subgraph(trees: &mut GeneratorData) {
    let sccs = petgraph::algo::kosaraju_scc(&trees.graph);
    let max_scc: HashSet<petgraph::graph::NodeIndex> = sccs
        .into_iter()
        .max_by(|c1, c2| c1.len().cmp(&c2.len()))
        .unwrap()
        .into_iter()
        .collect();
    console_log!("Largest connected component has {} nodes", max_scc.len());
    trim_to_nodes(trees, &max_scc);
}

fn trim_to_closest_subgraph(
    trees: &mut GeneratorData,
    maximum_distance: f64,
) -> Result<(), &'static str> {
    let home_enu = Point::new(0.0, 0.0);
    let starting_line = trees.segments_tree.nearest_neighbor(&home_enu).unwrap();
    console_log!("starting_line: {:?}", starting_line);
    let starting_point = match starting_line.geom().closest_point(&home_enu) {
        ::geo::Closest::Intersection(point) => point,
        ::geo::Closest::SinglePoint(point) => point,
        ::geo::Closest::Indeterminate => return Err("Indeterminate starting point"),
    };
    console_log!("starting_point: {:?}", starting_point);
    let distance_to_starting_point = starting_point.distance_2(&home_enu).sqrt();
    console_log!(
        "distance_to_starting_point: {:?}",
        distance_to_starting_point
    );
    let fraction_along_line = starting_line
        .geom()
        .line_locate_point(&starting_point)
        .unwrap();
    console_log!("fraction_along_line: {:?}", fraction_along_line);
    let (starting_node, distance_to_starting_node) = if fraction_along_line < 0.5 {
        (
            trees.graph.edge_endpoints(starting_line.data).unwrap().0,
            distance_to_starting_point
                + fraction_along_line
                    * ::geo::algorithm::line_measures::Euclidean.length(starting_line.geom()),
        )
    } else {
        (
            trees.graph.edge_endpoints(starting_line.data).unwrap().1,
            distance_to_starting_point
                + (1.0 - fraction_along_line)
                    * ::geo::algorithm::line_measures::Euclidean.length(starting_line.geom()),
        )
    };
    console_log!("starting_node: {:?}", starting_node);
    console_log!("distance_to_starting_node: {:?}", distance_to_starting_node);
    let node_distances =
        petgraph::algo::dijkstra::dijkstra(&trees.graph, starting_node, None, |edge| {
            *edge.weight()
        });
    let nodes_within_distance: HashSet<petgraph::graph::NodeIndex> = node_distances
        .iter()
        .filter_map(|(node_id, distance)| {
            if *distance <= maximum_distance - distance_to_starting_node {
                Some(*node_id)
            } else {
                None
            }
        })
        .collect();
    drop(node_distances);
    console_log!("{} nodes within range", nodes_within_distance.len());
    let neighbors = nodes_within_distance
        .iter()
        .flat_map(|node_index| trees.graph.neighbors(*node_index));
    let include_nodes = std::iter::chain(nodes_within_distance.iter().copied(), neighbors);
    trim_to_nodes(trees, &(include_nodes.collect()));
    Ok(())
}

#[wasm_bindgen]
pub fn generate(
    params: &GenerateParams,
) -> Result<js_sys::Map<js_sys::Number, js_sys::Array<js_sys::Number>>, &'static str> {
    let Ok(seed) = params
        .seed_name()
        .parse::<u128>()
        // 1e20 is the maximum as defined by seeddigits in BaseClasses.py.
        // Multiply and divide the seed to bring it down from 1e20 range to u64::MAX range.
        // Finally, xor with the team & slot numbers so that different AP-Go
        // participants in the same AP game have different sets of trips.
        .map(|x| {
            ((x * 17592186044416 / 95367431640625) as u64)
                ^ ((params.team() as u64) << 32)
                ^ (params.slot() as u64)
        })
    else {
        return Err("Couldn't parse seed");
    };
    let mut rng = rand::rngs::SmallRng::seed_from_u64(seed);
    let home: Coord = if params.home().len() == 2 {
        (params.home()[0], params.home()[1]).into()
    } else {
        return Err("Couldn't parse home");
    };
    let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(&home);
    let geo_mat = ecef_mat.transposed();

    let mut min_dist = params.slot_data().minimum_distance();
    if min_dist > params.slot_data().maximum_distance() {
        min_dist = params.slot_data().maximum_distance() * (1.0 - DISTANCE_LENIENCY_M);
    }

    /*/
    let mut min_max_dist_tier_number_locations_per_area = HashMap::<u8, (f64, f64, usize)>::new();
    for trip_js in js_sys::Object::values(&params.slot_data().trips()) {
        let trip = trip_js.unchecked_ref::<Trip>();
        let area = trip.key_needed() as u8;
        let distance = trip.distance_tier();

        min_max_dist_tier_number_locations_per_area.insert(
            area,
            min_max_dist_tier_number_locations_per_area
                .get(&area)
                .map(|(min_dist, max_dist, count)| {
                    (min_dist.min(distance), max_dist.max(distance), count + 1)
                })
                .unwrap_or((distance, distance, 1)),
        );
    }
    for (area, (min_dist, max_dist, count)) in min_max_dist_tier_number_locations_per_area.iter() {
        console_log!("Area {area}: {count} trips at between tier {min_dist} and {max_dist}");
    }
    */

    // (first node ID, last node ID)
    let mut trees = build_trees(
        &params
            .osm()
            .elements()
            .iter()
            .filter_map(|el| {
                if el.r#type() == "node" {
                    let node = el.unchecked_ref::<JsOsmNode>();
                    Some(osm_types::Element::Node(osm_types::Node {
                        id: osm_types::Id(node.id() as i64),
                        tags: node
                            .tags()
                            .map(|a| js_sys::Reflect::own_keys(&a))
                            .and_then(|b| js_sys::try_iter(&b.unwrap()).unwrap())
                            .map(|c| {
                                c.map(|key| {
                                    let key2 = key.unwrap();
                                    (
                                        key2.as_string().unwrap(),
                                        js_sys::Reflect::get(&node.tags().unwrap(), &key2)
                                            .unwrap()
                                            .as_string()
                                            .unwrap(),
                                    )
                                })
                                .collect()
                            }),
                        info: None,
                        lat: node.lat(),
                        lon: node.lon(),
                    }))
                } else if el.r#type() == "way" {
                    let way = el.unchecked_ref::<JsOsmWay>();
                    Some(osm_types::Element::Way(osm_types::Way {
                        id: osm_types::Id(way.id() as i64),
                        tags: way
                            .tags()
                            .map(|a| js_sys::Reflect::own_keys(&a))
                            .and_then(|b| js_sys::try_iter(&b.unwrap()).unwrap())
                            .map(|c| {
                                c.map(|key| {
                                    let key2 = key.unwrap();
                                    (
                                        key2.as_string().unwrap(),
                                        js_sys::Reflect::get(&way.tags().unwrap(), &key2)
                                            .unwrap()
                                            .as_string()
                                            .unwrap(),
                                    )
                                })
                                .collect()
                            }),
                        info: None,
                        nodes: way
                            .nodes()
                            .iter()
                            .map(|node_id_float| osm_types::Id(*node_id_float as i64))
                            .collect(),
                    }))
                } else {
                    None
                }
            })
            .collect::<Vec<osm_types::Element>>(),
        &ref_ecef,
        &ecef_mat,
    );
    if trees.segments_tree.size() == 0 {
        return Err("No segments");
    }

    match params.subgraph_selection() {
        SubgraphSelection::FullGraph => {}
        SubgraphSelection::BiggestSubgraph => trim_to_biggest_subgraph(&mut trees),
        SubgraphSelection::ClosestSubgraph => {
            trim_to_closest_subgraph(&mut trees, params.slot_data().maximum_distance())?
        }
    }

    let mut points_tree = RTree::<GeomWithData<Point, i64>>::new();
    let trip_points: js_sys::Map<js_sys::Number, js_sys::Array<js_sys::Number>> =
        js_sys::Map::new_typed();

    params.locations().for_each(&mut |trip_name, location_id| {
        let trip: Trip = js_sys::Reflect::get(&params.slot_data().trips(), &trip_name)
            .unwrap()
            .unchecked_into();

        let max_dist = distance_tier_to_maximum_distance(trip.distance_tier(), params.slot_data().minimum_distance(), params.slot_data().maximum_distance());

        let mut attempt = 1;
        const MAX_ATTEMPTS: i32 = 256;
        loop {
            console_log!(
                    "Attempt {attempt}: Generating random point with radius between {min_dist} and {max_dist}"
                );

            let random_point = random_point_in_circle(min_dist, max_dist, &mut rng);
            console_log!("Random point is {random_point:?}");

            // Don't generate points too close to each other, but at a lower priority than
            // checking for nearby segments
            if attempt < MAX_ATTEMPTS / 2
                && let Some(nearest_other_point) = points_tree.nearest_neighbor(&random_point)
                && random_point.distance_2(nearest_other_point.geom())
                    < GENERATED_DISTANCE_THRESHOLD_M_2
            {
                continue;
            }

            let Some(nearest_segment) = trees.segments_tree.nearest_neighbor(&random_point) else {
                // empty tree?
                return;
            };
            let nearest_point_on_segment = match nearest_segment.geom().closest_point(&random_point) {
                ::geo::Closest::Indeterminate => continue,
                ::geo::Closest::Intersection(point) => point,
                ::geo::Closest::SinglePoint(point) => point,
            };
            let distance_to_nearest_point_m_2 =
                random_point.distance_2(&nearest_point_on_segment);
            if distance_to_nearest_point_m_2 < GENERATED_DISTANCE_THRESHOLD_M_2
                || attempt >= MAX_ATTEMPTS
            {
                let selected_point = if attempt < MAX_ATTEMPTS {
                    random_point
                } else {
                    console_log!("Out of attempts, snapping to {nearest_point_on_segment:?}");
                    nearest_point_on_segment
                };
                points_tree.insert(GeomWithData::new(
                    selected_point,
                    location_id.as_f64().unwrap() as i64,
                ));
                // TODO: Route from here to home:
                // - Snap home point to network, include that distance in route length
                // - Reroll if point isn't routable or if route is shorter than min_dist
                // - Trim route to selected distance, use that new end point
                let enu_coord = Coord3d {
                    x: selected_point.x(),
                    y: selected_point.y(),
                    z: 0.0,
                };
                let geo_coord = enu_to_geo(&enu_coord, &ref_ecef, &geo_mat);
                let arr: js_sys::Array<js_sys::Number> =
                    js_sys::Array::new_with_length_typed(2);
                arr.set(0, geo_coord.x.into());
                arr.set(1, geo_coord.y.into());
                trip_points.set(&location_id, &arr);
                break;
            }
            attempt += 1;
        }
    });

    Ok(trip_points)
}

fn random_point_in_circle<T: Rng, U: ::geo::CoordFloat + num_traits::FloatConst>(
    min_dist: U,
    max_dist: U,
    rng: &mut T,
) -> ::geo::Point<U>
where
    rand::distributions::Standard: rand::distributions::Distribution<U>,
{
    let r = (max_dist - min_dist) * rng.r#gen::<U>().sqrt() + min_dist;
    let theta = rng.r#gen::<U>() * U::TAU();
    let (st, ct) = theta.sin_cos();
    ::geo::Point::<U>::new(r * ct, r * st)
}

#[wasm_bindgen]
pub fn set_up_with_saved_points(
    home_vec: Vec<f64>,
    points: js_sys::Map<js_sys::Number, js_sys::Array<js_sys::Number>>,
) -> Internal {
    let home: Coord = (home_vec[0], home_vec[1]).into();
    let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(&home);

    let points_tree = RTree::<GeomWithData<Point, i64>>::bulk_load(
        points
            .keys()
            .into_iter()
            .flatten()
            .map(|location_id| {
                let v = points.get(&location_id);
                let enu_coord = geo_to_enu(
                    &(v.get(0).as_f64().unwrap(), v.get(1).as_f64().unwrap()).into(),
                    &ref_ecef,
                    &ecef_mat,
                );
                GeomWithData::new(
                    (enu_coord.x, enu_coord.y).into(),
                    location_id.as_f64().unwrap() as i64,
                )
            })
            .collect(),
    );

    Internal {
        points_rtree: Some(points_tree),
        ref_ecef: Some(ref_ecef),
        ecef_mat: Some(ecef_mat),
    }
}

fn _points_in_radius(
    internal: &Internal,
    point_arr: js_sys::Array<js_sys::Number>,
    distance: f64,
) -> Result<Vec<i64>, ()> {
    let coord_geo: Coord = (
        point_arr.get(0).as_f64().ok_or(())?,
        point_arr.get(1).as_f64().ok_or(())?,
    )
        .into();
    let coord_enu = geo_to_enu(
        &coord_geo,
        &internal.ref_ecef.ok_or(())?,
        &internal.ecef_mat.ok_or(())?,
    );
    let point_enu: Point = (coord_enu.x, coord_enu.y).into();
    if let Some(points_tree) = &internal.points_rtree {
        Ok(points_tree
            .locate_within_distance(point_enu, distance * distance)
            .map(|p| p.data)
            .collect())
    } else {
        Err(())
    }
}

#[wasm_bindgen]
pub fn points_in_radius(
    internal: &Internal,
    point_arr: js_sys::Array<js_sys::Number>,
    distance: f64,
) -> JsValue {
    if let Ok(res) = _points_in_radius(internal, point_arr, distance) {
        let ret: js_sys::Array<JsValue> =
            res.iter().map(|i| JsValue::from_f64(*i as f64)).collect();
        ret.into()
    } else {
        JsValue::null()
    }
}

fn choose_areas(
    rng: &mut rand::rngs::SmallRng,
    ref_ecef: &Coord3d,
    ecef_mat: &AffineTransform3d,
    geo_mat: &AffineTransform3d,
    min_dist: f64,
    max_dist: f64,
    min_max_dist_tier_number_locations_per_area: &HashMap<u8, (f64, f64, usize)>,
) {
    let random_point_per_area: HashMap<u8, ::geo::Point> =
        min_max_dist_tier_number_locations_per_area
            .iter()
            .map(|(area, (min_dist_tier, _max_dist_tier, _count))| {
                // seed areas within the smallest distance tier of that area
                (
                    *area,
                    random_point_in_circle(
                        min_dist,
                        distance_tier_to_maximum_distance(*min_dist_tier, min_dist, max_dist),
                        rng,
                    ),
                )
            })
            .collect();
}

#[cfg(test)]
mod tests {
    use crate::*;
    use ::geo::{Buffer, MapCoords};
    use geojson::{Feature, FeatureCollection, GeoJson, Geometry};

    fn segments_to_geojson(
        ref_ecef: &Coord3d,
        geo_mat: &AffineTransform3d,
        trees: &GeneratorData,
    ) -> GeoJson {
        let segments: Vec<::geo::MultiPolygon> = trees
            .segments_tree
            .iter()
            .map(|segment| segment.geom().buffer(COLLECTION_DISTANCE_BASE_M))
            .collect();
        let points: Vec<::geo::Point> = trees
            .points_tree
            .iter()
            .map(|point| *point.geom())
            .collect();
        let xfrm_coord = |coord: Coord| {
            let enu_coord = Coord3d {
                x: coord.x,
                y: coord.y,
                z: 0.0,
            };
            enu_to_geo(&enu_coord, ref_ecef, geo_mat)
        };
        GeoJson::FeatureCollection(FeatureCollection::from_iter([
            Feature::from(Geometry::from(
                &::geo::algorithm::unary_union(segments.iter().by_ref()).map_coords(xfrm_coord),
            )),
            Feature::from(Geometry::from(
                &::geo::MultiPoint::from(points).map_coords(xfrm_coord),
            )),
        ]))
    }

    #[derive(serde::Deserialize)]
    struct OsmDoc {
        elements: Vec<osm_types::Element>,
    }

    #[test]
    pub fn test_graphs() {
        let home = Coord {
            x: -116.88429227615799,
            y: 32.55584395634817,
        };
        let doc: OsmDoc =
            serde_json::from_str(&std::fs::read_to_string("testdata.json").unwrap()).unwrap();

        let (ref_ecef, ecef_mat) = geo_ref_ecef_mat(&home);
        let geo_mat = ecef_mat.transposed();
        let trees = build_trees(&doc.elements, &ref_ecef, &ecef_mat);

        {
            let geojson = GeoJson::FeatureCollection(FeatureCollection::from_iter(
                trees.segments_tree.iter().map(|seg| {
                    Feature::from(Geometry::from(&seg.geom().map_coords(|coord| {
                        let enu_coord = Coord3d {
                            x: coord.x,
                            y: coord.y,
                            z: 0.0,
                        };
                        enu_to_geo(&enu_coord, &ref_ecef, &geo_mat)
                    })))
                }),
            ));
            let geojson_string = geojson.to_string();
            std::fs::write("segments.geojson", geojson_string).unwrap();
        }

        {
            let mut biggest_tree = trees.clone();
            let now = std::time::Instant::now();
            trim_to_biggest_subgraph(&mut biggest_tree);
            println!(
                "trim_to_biggest_subgraph took {}ms",
                now.elapsed().as_millis()
            );
            let geojson_string =
                segments_to_geojson(&ref_ecef, &geo_mat, &biggest_tree).to_string();
            std::fs::write("biggest_subgraph.geojson", geojson_string).unwrap();
        }
        {
            let mut closest_tree = trees.clone();
            let now = std::time::Instant::now();
            assert!(trim_to_closest_subgraph(&mut closest_tree, 5000.0).is_ok());
            println!(
                "trim_to_closest_subgraph took {}ms",
                now.elapsed().as_millis()
            );
            let geojson_string =
                segments_to_geojson(&ref_ecef, &geo_mat, &closest_tree).to_string();
            std::fs::write("closest_subgraph.geojson", geojson_string).unwrap();
        }
    }
}
