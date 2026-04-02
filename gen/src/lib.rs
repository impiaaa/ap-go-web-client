use wasm_bindgen::prelude::*;
use web_sys::{DedicatedWorkerGlobalScope, MessageEvent, js_sys};
use web_sys::console;

#[wasm_bindgen(start)]
pub fn run() -> Result<(), JsValue> {
    console::log_1(&"In run".into());
    let self_ = js_sys::global().dyn_into::<DedicatedWorkerGlobalScope>()?;
    let c: wasm_bindgen::closure::Closure<dyn Fn(JsValue) -> ()> = wasm_bindgen::closure::Closure::new(onmessage);
    let f = js_sys::Function::from_closure(c);
    self_.set_onmessage(Some(&f));
    Ok(())
}

#[wasm_bindgen]
extern "C" {
    pub type OverpassResponse;
    pub type OsmElement;

    #[wasm_bindgen(structural, method, getter)]
    pub fn elements(this: &OverpassResponse) -> Vec<OsmElement>;
}

fn onmessage(event_obj: JsValue) {
    console::log_1(&"onmessage".into());
    let self_ = js_sys::global().dyn_into::<DedicatedWorkerGlobalScope>().unwrap();
    let event = event_obj.dyn_into::<MessageEvent>().unwrap();
    let elements = event.data().dyn_into::<OverpassResponse>().unwrap().elements();
    let nodes: Vec<&OsmElement> = elements.iter().filter(|el| js_sys::Reflect::get(&el, &JsValue::from("type")).is_ok_and(|typ| typ.as_string().is_some_and(|s| s == "node"))).collect();
    self_.post_message(nodes[0]).unwrap();
}