(ns cloud-itonami.app-fleamarket.desktop
  "Entry point for the shadow-cljs :app build (web/dist/js/main.js, loaded
  by web/index.html) — same mount pattern as murakumo-studio.desktop and
  cloud-itonami.app-itonami.desktop."
  (:require [reagent.dom.client :as rdomc]
            [cloud-itonami.app-fleamarket.ui :as ui]))

(defonce root (atom nil))

(defn init! []
  (let [el (.getElementById js/document "app")]
    (when-not @root
      (reset! root (rdomc/create-root el)))
    (rdomc/render @root [ui/root])))
