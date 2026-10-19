/* ==========================================================================
   Mis Aventuras RD — motor del mapa
   Proyección Web Mercator, contorno vectorial detallado, zoom, arrastre,
   pellizco, inercia, etiquetas y colocación de puntos.
   Sin dependencias externas.
   ========================================================================== */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var DEG = Math.PI / 180;
  var MAX_LAT = 85.05112878;

  var CITIES = [
    { name: "Santo Domingo", lon: -69.9312, lat: 18.4861, tier: 1 },
    { name: "Santiago", lon: -70.6970, lat: 19.4517, tier: 1 },
    { name: "Puerto Plata", lon: -70.6884, lat: 19.7934, tier: 1 },
    { name: "Punta Cana", lon: -68.3725, lat: 18.5601, tier: 1 },
    { name: "La Romana", lon: -68.9728, lat: 18.4273, tier: 1 },
    { name: "Samaná", lon: -69.3360, lat: 19.2056, tier: 1 },
    { name: "Barahona", lon: -71.1008, lat: 18.2085, tier: 1 },
    { name: "San Juan", lon: -71.2298, lat: 18.8059, tier: 1 },
    { name: "Monte Cristi", lon: -71.6450, lat: 19.8470, tier: 1 },
    { name: "Higüey", lon: -68.7075, lat: 18.6157, tier: 1 },
    { name: "San Pedro", lon: -69.2972, lat: 18.4539, tier: 2 },
    { name: "La Vega", lon: -70.5294, lat: 19.2222, tier: 2 },
    { name: "Azua", lon: -70.7345, lat: 18.4532, tier: 2 },
    { name: "Pedernales", lon: -71.7440, lat: 18.0384, tier: 2 },
    { name: "Dajabón", lon: -71.7080, lat: 19.5488, tier: 2 },
    { name: "Nagua", lon: -69.8477, lat: 19.3832, tier: 2 },
    { name: "Bonao", lon: -70.4092, lat: 18.9369, tier: 2 },
    { name: "Constanza", lon: -70.7440, lat: 18.9092, tier: 2 },
    { name: "Jarabacoa", lon: -70.6333, lat: 19.1167, tier: 2 },
    { name: "Neiba", lon: -71.4197, lat: 18.4814, tier: 2 }
  ];

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  // Trabajamos con una Y de Mercator invertida (sur = mayor, norte = menor)
  // para que el eje Y del SVG coincida con la pantalla sin voltear los textos.
  function mercY(lat) {
    lat = clamp(lat, -MAX_LAT, MAX_LAT);
    return -Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / DEG;
  }

  function invMercY(y) {
    return (2 * Math.atan(Math.exp(-y * DEG)) - Math.PI / 2) / DEG;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        el.setAttribute(key, attrs[key]);
      });
    }
    return el;
  }

  function MapView(options) {
    this.el = options.container;
    this.svg = options.svg;
    this.world = options.world;
    this.land = options.land;
    this.coastGlow = options.coastGlow;
    this.cityLayer = options.cityLayer;
    this.countryLabel = options.countryLabel;
    this.seaCaribbean = options.seaCaribbean;
    this.seaAtlantic = options.seaAtlantic;
    this.geo = options.geo;
    this.onView = options.onView || function () {};
    this.onClick = options.onClick || function () {};
    this.getInsets = options.getInsets || function () {
      return { top: 170, right: 20, bottom: 110, left: 20 };
    };

    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.cx = -70.35;
    this.cy = mercY(18.75);
    this.homeScale = 1;
    this.minScale = 1;
    this.maxScale = 1;
    this.insets = { top: 170, right: 20, bottom: 110, left: 20 };
    this.ready = false;
    this.enabled = true;
    this.userMoved = false;

    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.velocity = { x: 0, y: 0 };
    this.lastMove = null;
    this.dragMoved = false;
    this.dragStartTime = 0;
    this.inertiaFrame = null;
    this.tapTimer = null;
    this.lastTap = null;
    this.animFrame = null;

    this.bbox = {
      x0: this.geo.bbox[0],
      y0: mercY(this.geo.bbox[3]), // norte: Y menor
      x1: this.geo.bbox[2],
      y1: mercY(this.geo.bbox[1])  // sur: Y mayor
    };
    this.centerWorld = {
      x: (this.bbox.x0 + this.bbox.x1) / 2,
      y: (this.bbox.y0 + this.bbox.y1) / 2
    };

    this.buildGeometry();
    this.buildLabels();
    this.bindEvents();

    this._resizeFrame = null;
    this.resize(true);

    var self = this;
    if (typeof ResizeObserver === "function") {
      this._resizeObserver = new ResizeObserver(function () {
        if (self._resizeFrame) cancelAnimationFrame(self._resizeFrame);
        self._resizeFrame = requestAnimationFrame(function () {
          self._resizeFrame = null;
          self.resize(false);
        });
      });
      this._resizeObserver.observe(this.el);
    } else {
      window.addEventListener("resize", function () {
        self.resize(false);
      });
    }
  }

  MapView.prototype.buildGeometry = function () {
    var self = this;
    var path = this.geo.polygons.map(function (ring) {
      var parts = new Array(ring.length);
      for (var i = 0; i < ring.length; i++) {
        parts[i] = ring[i][0].toFixed(5) + " " + mercY(ring[i][1]).toFixed(5);
      }
      return "M" + parts.join("L") + "Z";
    }).join("");
    this.land.setAttribute("d", path);
    this.coastGlow.setAttribute("d", path);
    this.land.setAttribute("fill-rule", "nonzero");
    this.coastGlow.setAttribute("fill-rule", "nonzero");
    this.pathD = path;

    // Etiqueta del país y mares: posición fija en coordenadas del mundo.
    this.countryPos = { x: -70.42, y: mercY(18.88) };
    this.caribbeanPos = { x: -70.55, y: mercY(17.63) };
    this.atlanticPos = { x: -69.55, y: mercY(20.20) };
  };

  MapView.prototype.buildLabels = function () {
    var self = this;
    this.cities = CITIES.map(function (city) {
      var g = svgEl("g", { class: "city" });
      var dot = svgEl("circle", { class: "city-dot", cx: 0, cy: 0, r: 2.4 });
      var text = svgEl("text", { class: "city-text", x: 7, y: 0 });
      text.textContent = city.name;
      g.appendChild(dot);
      g.appendChild(text);
      self.cityLayer.appendChild(g);
      return { data: city, g: g, dot: dot, text: text };
    });
  };

  MapView.prototype.start = function () {
    this.ready = true;
    this.apply();
  };

  MapView.prototype.setEnabled = function (enabled) {
    this.enabled = !!enabled;
    if (!enabled) {
      this.stopInertia();
      this.cancelAnimation();
      this.pointers.clear();
      this.drag = null;
      this.pinch = null;
      this.el.classList.remove("is-dragging");
    }
  };

  MapView.prototype.resize = function (refit) {
    var width = this.el.clientWidth;
    var height = this.el.clientHeight;
    if (!width || !height) return;

    var oldHome = this.homeScale || 1;
    var wasHome = !this.userMoved || Math.abs(this.scale / oldHome - 1) < 0.08;

    this.width = width;
    this.height = height;
    this.svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    this.insets = this.getInsets();

    var fit = this.computeFit();
    this.homeScale = fit.scale;
    this.minScale = fit.scale * 0.72;
    this.maxScale = fit.scale * 30;

    if (refit || wasHome) {
      this.scale = fit.scale;
      this.cx = fit.cx;
      this.cy = fit.cy;
      this.userMoved = false;
    } else {
      this.scale = clamp(this.scale, this.minScale, this.maxScale);
      this.constrain();
    }
    this.apply();
  };

  MapView.prototype.computeFit = function () {
    var width = this.width;
    var height = this.height;
    var insets = this.insets;
    var availW = Math.max(120, width - insets.left - insets.right);
    var availH = Math.max(120, height - insets.top - insets.bottom);
    var bw = this.bbox.x1 - this.bbox.x0;
    var bh = this.bbox.y1 - this.bbox.y0;
    var scale = Math.min(availW / bw, availH / bh) * 0.955;
    var cx = (this.bbox.x0 + this.bbox.x1) / 2;
    var desiredCenterY = insets.top + availH / 2;
    var cy = this.centerWorld.y - (desiredCenterY - height / 2) / scale;
    return { scale: scale, cx: cx, cy: cy };
  };

  MapView.prototype.constrain = function () {
    var pad = this.scale < this.homeScale * 1.25 ? 0.35 : 1.4;
    this.cx = clamp(this.cx, this.bbox.x0 - pad, this.bbox.x1 + pad);
    this.cy = clamp(this.cy, this.bbox.y0 - pad, this.bbox.y1 + pad);
  };

  MapView.prototype.project = function (lon, lat) {
    return { x: lon, y: mercY(lat) };
  };

  MapView.prototype.unproject = function (x, y) {
    return {
      lon: this.cx + (x - this.width / 2) / this.scale,
      lat: invMercY(this.cy + (y - this.height / 2) / this.scale)
    };
  };

  MapView.prototype.screen = function (lon, lat) {
    var p = this.project(lon, lat);
    return {
      x: this.width / 2 + (p.x - this.cx) * this.scale,
      y: this.height / 2 + (p.y - this.cy) * this.scale
    };
  };

  MapView.prototype.apply = function () {
    if (!this.width || !this.height) return;
    var tx = this.width / 2 - this.cx * this.scale;
    var ty = this.height / 2 - this.cy * this.scale;
    this.world.setAttribute(
      "transform",
      "translate(" + tx.toFixed(3) + " " + ty.toFixed(3) + ") scale(" + this.scale.toFixed(6) + ")"
    );
    this.updateLabels();
    if (this.ready) this.onView(this);
  };

  MapView.prototype.updateLabels = function () {
    var scale = this.scale;
    var ratio = scale / this.homeScale;

    var countrySize = 22 / scale;
    this.countryLabel.setAttribute("font-size", countrySize);
    this.countryLabel.setAttribute("stroke-width", 3.2 / scale);
    this.countryLabel.setAttribute(
      "transform",
      "translate(" + this.countryPos.x + " " + this.countryPos.y + ")"
    );
    this.countryLabel.style.opacity = String(clamp(1 - (ratio - 1) / 2.2, 0, 1) * 0.3);

    this.seaCaribbean.setAttribute("font-size", 11.5 / scale);
    this.seaCaribbean.setAttribute("stroke-width", 3 / scale);
    this.seaCaribbean.setAttribute(
      "transform",
      "translate(" + this.caribbeanPos.x + " " + this.caribbeanPos.y + ")"
    );
    this.seaCaribbean.style.opacity = String(clamp(1 - (ratio - 1) / 2.6, 0, 1) * 0.46);

    this.seaAtlantic.setAttribute("font-size", 11.5 / scale);
    this.seaAtlantic.setAttribute("stroke-width", 3 / scale);
    this.seaAtlantic.setAttribute(
      "transform",
      "translate(" + this.atlanticPos.x + " " + this.atlanticPos.y + ")"
    );
    this.seaAtlantic.style.opacity = String(clamp(1 - (ratio - 1) / 2.6, 0, 1) * 0.46);

    var size = 11.5 / scale;
    for (var i = 0; i < this.cities.length; i++) {
      var item = this.cities[i];
      var start = item.data.tier === 1 ? 1.22 : 2.05;
      var opacity = clamp((ratio - start) / 0.38, 0, 1) * 0.92;
      if (opacity < 0.025) {
        item.g.style.display = "none";
        continue;
      }
      item.g.style.display = "";
      item.g.style.opacity = String(opacity);
      var p = this.project(item.data.lon, item.data.lat);
      item.g.setAttribute("transform", "translate(" + p.x.toFixed(5) + " " + p.y.toFixed(5) + ")");
      item.dot.setAttribute("r", (2.3 / scale).toFixed(5));
      item.dot.setAttribute("stroke-width", (1.2 / scale).toFixed(5));
      item.text.setAttribute("font-size", size.toFixed(5));
      item.text.setAttribute("x", (7 / scale).toFixed(5));
      item.text.setAttribute("stroke-width", (3 / scale).toFixed(5));
    }
  };

  MapView.prototype.cancelAnimation = function () {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  };

  MapView.prototype.stopInertia = function () {
    if (this.inertiaFrame) {
      cancelAnimationFrame(this.inertiaFrame);
      this.inertiaFrame = null;
    }
  };

  MapView.prototype.zoomBy = function (factor, animate) {
    var target = clamp(this.scale * factor, this.minScale, this.maxScale);
    if (Math.abs(target - this.scale) < 0.0001) return;
    if (animate) {
      this.animateTo(this.cx, this.cy, target, 260);
    } else {
      this.scale = target;
      this.constrain();
      this.apply();
    }
    this.userMoved = true;
  };

  MapView.prototype.zoomAt = function (factor, sx, sy, animate) {
    var target = clamp(this.scale * factor, this.minScale, this.maxScale);
    if (Math.abs(target - this.scale) < 0.0001) return;
    var world = this.project(this.cx + (sx - this.width / 2) / this.scale, invMercY(this.cy + (sy - this.height / 2) / this.scale));
    var nextCx = world.x - (sx - this.width / 2) / target;
    var nextCy = world.y - (sy - this.height / 2) / target;
    this.userMoved = true;
    if (animate) {
      this.animateTo(nextCx, nextCy, target, 260);
    } else {
      this.scale = target;
      this.cx = nextCx;
      this.cy = nextCy;
      this.constrain();
      this.apply();
    }
  };

  MapView.prototype.animateTo = function (cx, cy, scale, duration, done) {
    var self = this;
    this.cancelAnimation();
    this.stopInertia();
    var start = { cx: this.cx, cy: this.cy, scale: this.scale };
    var target = {
      cx: clamp(cx, this.bbox.x0 - 1.4, this.bbox.x1 + 1.4),
      cy: clamp(cy, this.bbox.y0 - 1.4, this.bbox.y1 + 1.4),
      scale: clamp(scale, this.minScale, this.maxScale)
    };
    var t0 = performance.now();
    var durationMs = duration || 360;

    function frame(now) {
      var t = Math.min(1, (now - t0) / durationMs);
      var e = easeInOutCubic(t);
      self.cx = start.cx + (target.cx - start.cx) * e;
      self.cy = start.cy + (target.cy - start.cy) * e;
      self.scale = start.scale + (target.scale - start.scale) * e;
      self.apply();
      if (t < 1) {
        self.animFrame = requestAnimationFrame(frame);
      } else {
        self.animFrame = null;
        if (typeof done === "function") done();
      }
    }
    this.animFrame = requestAnimationFrame(frame);
  };

  MapView.prototype.home = function (animate) {
    var fit = this.computeFit();
    this.userMoved = false;
    if (animate === false) {
      this.scale = fit.scale;
      this.cx = fit.cx;
      this.cy = fit.cy;
      this.apply();
    } else {
      this.animateTo(fit.cx, fit.cy, fit.scale, 460, function () {
        // Mantener la vista como "vista general" aunque se redimensione.
      });
    }
  };

  MapView.prototype.flyTo = function (lon, lat, scale, duration) {
    var p = this.project(lon, lat);
    this.userMoved = true;
    this.animateTo(p.x, p.y, scale || Math.max(this.scale, this.homeScale * 2.4), duration || 420);
  };

  MapView.prototype.ensureVisible = function (lon, lat, padding) {
    if (!this.width || !this.height) return;
    var p = this.screen(lon, lat);
    var pad = padding || 90;
    var top = this.insets.top + 30;
    var bottom = this.height - 120;
    if (p.x < pad || p.x > this.width - pad || p.y < top || p.y > bottom) {
      var pWorld = this.project(lon, lat);
      var scale = Math.max(this.scale, this.homeScale * 1.45);
      this.userMoved = true;
      this.animateTo(pWorld.x, pWorld.y, scale, 400);
    }
  };

  MapView.prototype.bindEvents = function () {
    var self = this;

    this.el.addEventListener("pointerdown", function (event) {
      self.onPointerDown(event);
    });
    this.el.addEventListener("pointermove", function (event) {
      self.onPointerMove(event);
    });
    this.el.addEventListener("pointerup", function (event) {
      self.onPointerUp(event);
    });
    this.el.addEventListener("pointercancel", function (event) {
      self.onPointerCancel(event);
    });

    this.el.addEventListener("wheel", function (event) {
      if (!self.enabled) return;
      event.preventDefault();
      self.stopInertia();
      self.cancelAnimation();
      var delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;
      else if (event.deltaMode === 2) delta *= 100;
      var factor = Math.exp(-delta * (event.ctrlKey ? 0.012 : 0.0018));
      factor = clamp(factor, 0.45, 2.2);
      self.zoomAt(factor, event.clientX, event.clientY, false);
    }, { passive: false });

    this.el.addEventListener("keydown", function (event) {
      if (!self.enabled) return;
      var key = event.key;
      var handled = true;
      if (key === "+" || key === "=") {
        self.zoomBy(1.5, true);
      } else if (key === "-" || key === "_") {
        self.zoomBy(0.66, true);
      } else if (key === "0" || key === "Home") {
        self.home(true);
      } else if (key === "ArrowLeft") {
        self.cx -= 90 / self.scale;
        self.constrain();
        self.apply();
      } else if (key === "ArrowRight") {
        self.cx += 90 / self.scale;
        self.constrain();
        self.apply();
      } else if (key === "ArrowUp") {
        self.cy += 90 / self.scale;
        self.constrain();
        self.apply();
      } else if (key === "ArrowDown") {
        self.cy -= 90 / self.scale;
        self.constrain();
        self.apply();
      } else {
        handled = false;
      }
      if (handled) {
        self.userMoved = true;
        event.preventDefault();
      }
    });
  };

  MapView.prototype.onPointerDown = function (event) {
    if (!this.enabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest && event.target.closest("button, a, input, select, textarea, .marker-card, .cluster-dot")) {
      return;
    }

    this.cancelAnimation();
    this.stopInertia();
    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }

    try {
      this.el.setPointerCapture(event.pointerId);
    } catch (error) { /* algunos navegadores no lo permiten */ }

    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.dragMoved = false;
    this.dragStartTime = performance.now();

    if (this.pointers.size === 1) {
      this.drag = { x: event.clientX, y: event.clientY };
      this.lastMove = { x: event.clientX, y: event.clientY, t: performance.now() };
      this.velocity = { x: 0, y: 0 };
      this.el.classList.add("is-dragging");
    } else if (this.pointers.size === 2) {
      this.startPinch();
      this.el.classList.add("is-dragging");
    }
  };

  MapView.prototype.startPinch = function () {
    var pts = Array.from(this.pointers.values());
    if (pts.length < 2) return;
    var center = midpoint(pts[0], pts[1]);
    var world = this.unproject(center.x, center.y);
    this.pinch = {
      dist: Math.max(1, distance(pts[0], pts[1])),
      scale: this.scale,
      world: this.project(world.lon, world.lat)
    };
    this.drag = null;
  };

  MapView.prototype.onPointerMove = function (event) {
    if (!this.enabled) return;
    if (!this.pointers.has(event.pointerId)) return;
    var previous = this.pointers.get(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      var pts = Array.from(this.pointers.values()).slice(0, 2);
      var center = midpoint(pts[0], pts[1]);
      var dist = Math.max(1, distance(pts[0], pts[1]));
      if (!this.pinch) {
        this.startPinch();
      } else {
        var targetScale = clamp(this.pinch.scale * (dist / this.pinch.dist), this.minScale, this.maxScale);
        this.scale = targetScale;
        this.cx = this.pinch.world.x - (center.x - this.width / 2) / this.scale;
        this.cy = this.pinch.world.y - (center.y - this.height / 2) / this.scale;
        this.constrain();
        this.dragMoved = true;
        this.userMoved = true;
        this.apply();
      }
      return;
    }

    if (this.pointers.size === 1 && this.drag) {
      var dx = event.clientX - previous.x;
      var dy = event.clientY - previous.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.01) return;

      this.cx -= dx / this.scale;
      this.cy -= dy / this.scale;
      this.constrain();
      this.apply();

      var now = performance.now();
      var dt = Math.max(1, now - this.lastMove.t);
      this.velocity = {
        x: (event.clientX - this.lastMove.x) / dt,
        y: (event.clientY - this.lastMove.y) / dt
      };
      this.lastMove = { x: event.clientX, y: event.clientY, t: now };
      if (Math.abs(dx) + Math.abs(dy) > 3) this.dragMoved = true;
      this.userMoved = true;
    }
  };

  MapView.prototype.onPointerUp = function (event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);

    if (this.pointers.size === 0) {
      this.el.classList.remove("is-dragging");
      var wasMoved = this.dragMoved;
      var duration = performance.now() - this.dragStartTime;

      if (!wasMoved && duration < 700) {
        this.handleTap(event.clientX, event.clientY);
      } else if (wasMoved) {
        var speed = Math.hypot(this.velocity.x, this.velocity.y);
        if (speed > 0.18) this.startInertia();
      }
      this.drag = null;
      this.pinch = null;
    } else if (this.pointers.size === 1) {
      var pt = Array.from(this.pointers.values())[0];
      this.drag = { x: pt.x, y: pt.y };
      this.lastMove = { x: pt.x, y: pt.y, t: performance.now() };
      this.pinch = null;
      this.velocity = { x: 0, y: 0 };
    }
  };

  MapView.prototype.onPointerCancel = function (event) {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) {
      this.el.classList.remove("is-dragging");
      this.drag = null;
      this.pinch = null;
    }
  };

  MapView.prototype.handleTap = function (x, y) {
    var self = this;
    var now = performance.now();
    if (this.lastTap && now - this.lastTap.t < 330 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 32) {
      this.lastTap = null;
      if (this.tapTimer) {
        clearTimeout(this.tapTimer);
        this.tapTimer = null;
      }
      this.zoomAt(1.9, x, y, true);
      return;
    }
    this.lastTap = { x: x, y: y, t: now };
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(function () {
      self.tapTimer = null;
      var point = self.unproject(x, y);
      self.onClick({
        lon: point.lon,
        lat: point.lat,
        screenX: x,
        screenY: y
      });
    }, 245);
  };

  MapView.prototype.startInertia = function () {
    var self = this;
    this.stopInertia();
    var vx = this.velocity.x;
    var vy = this.velocity.y;
    var last = performance.now();

    function step(now) {
      var dt = Math.min(34, now - last);
      last = now;
      self.cx -= (vx * dt) / self.scale;
      self.cy -= (vy * dt) / self.scale;
      self.constrain();
      self.apply();
      var decay = Math.pow(0.9, dt / 16);
      vx *= decay;
      vy *= decay;
      if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) {
        self.inertiaFrame = null;
        return;
      }
      self.inertiaFrame = requestAnimationFrame(step);
    }
    this.inertiaFrame = requestAnimationFrame(step);
  };

  window.MapView = MapView;
})();
