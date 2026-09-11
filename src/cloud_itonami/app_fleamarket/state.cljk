(ns cloud-itonami.app-fleamarket.state
  "App state for the fleamarket appview UI. Single reagent atom mirroring
  the app descriptor that appview/fleamarket-mcp-component/svelte's
  +page.svelte rendered (project facts, routes, runtime bindings)."
  (:require [reagent.core :as r]))

(defonce state
  (r/atom
   {:app {:title "Fleamarket Mcp Component"
          :project "etzhayyim-project-fleamarket"
          :name "fleamarket-mcp-component"
          :kind "appview"
          :route-count 0
          :routes []
          :vars []
          :xrpc true
          :relative-path "60-apps/etzhayyim-project-fleamarket/appview/fleamarket-mcp-component/svelte/src/routes/+page.svelte"}}))
