require('cesium/Source/Widgets/widgets.css');
require('./serverSend.js');


Cesium.BuildModuleUrl.setBaseUrl('./');
Cesium.BingMapsApi.defaultKey = keys.bingMapsKey;

var viewer = new Cesium.Viewer('cesiumContainer', {
    targetFrameRate: 60,
    homeButton: true,
    navigationHelpButton: true,
    navigationInstructionsInitiallyVisible: true,
    baseLayerPicker: false,
    fullscreenButton: false,
    clock: new Cesium.Clock({
      startTime: Cesium.JulianDate.fromIso8601('2021-12-01T00:00:00Z'),
      currentTime: Cesium.JulianDate.fromIso8601('2021-12-01T00:00:00Z'),
      stopTime: Cesium.JulianDate.fromIso8601("2045-12-01T00:00:00Z"),
      clockRange: Cesium.ClockRange.CLAMPED,
      canAnimate: false,
      shouldAnimate: false,
      timeline: false,
      multiplier: 15000000
    }),
    imageryProvider: new Cesium.BingMapsImageryProvider({
      url : 'https://dev.virtualearth.net',
      key : 'Hq6SkA7uenRDvLti9WrB~83O6IleO87mg8t3-De3ncg~Al9sLRxCHqiGuOLCWUITgNzg2MOn4bn3MrW04Mtj0UOybRzrlorT6-nXQUyEaL_k',
      baseLayerPicker: false
  }),
    automaticallyTrackDataSourceClocks: false
  });


  window.viewer = viewer;
  
  var selectedLocations = new Cesium.EntityCollection();
  var visibleMalaiseLocations = new Cesium.EntityCollection();
  visibleMalaiseLocations.suspendEvents();
  selectedLocations.suspendEvents();
  var selector;
  var redraw = false;
  var rectangleCoordinates = new Cesium.Rectangle();
  var updateHistogram;
  var updateHistogramThrottled;
  var spatialHash;
  var cameraMoving = false;
  //var cameraMoving2024 = true;
  
  viewer.scene.debugShowFramesPerSecond = config.debugShowFramesPerSecond;
  viewer.scene.screenSpaceCameraController.enableInputs = false;
  
  viewer.scene.screenSpaceCameraController.enableTranslate = false;
  viewer.scene.screenSpaceCameraController.enableTilt = false;
  viewer.scene.screenSpaceCameraController.enableLook = false;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 100100;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 160000000;
  viewer.scene.screenSpaceCameraController._minimumZoomRate = 50000;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  Cesium.Timeline.prototype.zoomTo = _.noop;
  Cesium.ArcGisMapServerImageryProvider.prototype.hasAlphaChannel = _.noop;
  
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var gregorianDate = new Cesium.GregorianDate(0, 0, 0, 0, 0, 0, 0, false);
  var dateFormatter = function (date) {
    gregorianDate = Cesium.JulianDate.toGregorianDate(date, gregorianDate);
    return monthNames[gregorianDate.month - 1] + ' ' + gregorianDate.year;
  };
  
  Cesium.Timeline.prototype.makeLabel = dateFormatter;
  viewer.animation.viewModel.dateFormatter = dateFormatter;
  viewer.animation.viewModel.timeFormatter = _.noop;


  var setLocationAppearance = function setLocationAppearance(station){
    if (typeof station._polygon == 'undefined'){
        setStationAppearance(station);
    }
    else{
        setGridAppearance(station);
    }
  }
  function updateColor(station){
   var r = station.color.red;
   var g = station.color.green;
   var b = station.color.blue;
   var a = station.color.alpha;
   console.log(station);
   station.polygon.material.color = new Cesium.Color(r, g, b, a);
  }
  
  var setStationAppearance = function setStationAppearance(station) {
    var toscale = 1.2;
    var getColor = new Cesium.CallbackProperty(function getColor(time, result) {
      if (typeof(result) == 'undefined'){
        console.log('call in station appearance');
      }
  
      result.red = station.color.red;
      result.green = station.color.green;
      result.blue = station.color.blue;
      result.alpha = station.color.alpha;
  
      return result;
    }, false);
  
    _.extend(station.billboard, {
      color: getColor,
      image: circle,
      scale: toscale,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      scaleByDistance: new Cesium.NearFarScalar(1.5e3, 1.5, 3e7, 0.2)
    });
  };
  
  var setGridAppearance = function setGridAppearance(station) {
    console.log('in setGridAppearance');
    var pos = station._polygon._hierarchy._value.positions;
    var coor = [];
    for (var i = 0; i < pos.length;i++){
      coor.push(Cesium.CesiumMath.toDegrees(Cesium.Cartographic.fromCartesian(pos[i]).longitude));
      coor.push(Cesium.CesiumMath.toDegrees(Cesium.Cartographic.fromCartesian(pos[i]).latitude));
    }
    station.polygon.hierarchy = Cesium.Cartesian3.fromDegreesArray(coor);
  
    var getColor = new Cesium.CallbackProperty(function getColor(time, result) {
    if (typeof station.temperature != 'undefined'){
      result.red = station.color.red;
      result.green = station.color.green;
      result.blue = station.color.blue;
      result.alpha = station.color.alpha;
      return result;
    }, false);
    _.extend(station.polygon.material, {
      outline : false,
      color : new Cesium.Color(0,1,0,0.6)
    });
  };

  function colorGlobe(json_val) {
    console.log(json_val)
    lat = json_val["lat"];
    long = json_val["long"];
    rectangles = json_val["rectangles"];
    console.log(rectangles)
    var gridEntitiesLength = Object.keys(rectangles).length;
    lat_count = 0;
    long_count = 0;
    for (var i = 0; i < gridEntitiesLength; i++) {
      if(i >0 && i%long == 0){
        long_count = 0;
        lat_count = lat_count + 1;
      }
      long_count = long_count + 1;
      var land = rectangles[i].land;
      if (!land){
        continue;
      }
      var coor = rectangles[i].coor;
      var w = coor.west;
      var s = coor.south;
      var e = coor.east;
      var n = coor.north;

      var rectangle = Cesium.Rectangle.fromDegrees(w, s, e, n);
      viewer.entities.add({
        rectangle : {
            coordinates : rectangle,
            fill : false,
            outline : true,
            //outlineColor : Cesium.Color.BLACK.withAlpha(0.2),//Cesium.Color.GREY,
            outlineColor : Cesium.Color.WHITE,
            outlineWidth: 1
        }
    });
    }
  }


  function populateGlobe(sampleTypes, sampleLocations) {
    var locationEntities = sampleLocations.entities.values;
    var locationEntitiesLength = locationEntities.length;
    var timelineTime = new Cesium.GregorianDate(0, 0, 0, 0, 0, 0, 0, false);
    var lastTime = new Cesium.GregorianDate(0, 0, 0, 0, 0, 0, 0, false);
    var stationCartographic = new Cesium.Cartographic();
    var spatialSelector = {x: 0, y: 0, width: 0, height: 0};
    var throttledUpdateStations = _.throttle(updateVisibleStations, 250);
    var $infoBox = $('.cesium-viewer-infoBoxContainer');
    var infoboxHidden = false;
  
    for (var i = 0; i < locationEntitiesLength; i++) {
      locationEntities[i].color = new Cesium.Color(1, 1, 1, 0.6);
      locationEntities[i].show = false;
      locationEntities[i].properties.station = locationEntities[i].properties.name;
      delete locationEntities[i].properties.name;
      setLocationAppearance(locationEntities[i]);
    }
  
    viewer.dataSources.add(sampleLocations);
  
    viewer.clock.onTick.addEventListener(function onClockTick(clock) {
      timelineTime = Cesium.JulianDate.toGregorianDate(clock.currentTime, timelineTime);
  
      if (cameraMoving) {
        throttledUpdateStations(sampleLocations, spatialSelector);
      }
  
      if (_.get(viewer, 'selectedEntity.selectable') === false) {
        $infoBox.hide();
        infoboxHidden = true;
      }
      else if (infoboxHidden) {
        $infoBox.show();
        infoboxHidden = false;
      }
  
      if (timelineTime.month !== lastTime.month || timelineTime.year !== lastTime.year || redraw) {
        //Deep copy
        lastTime.year = timelineTime.year;
        lastTime.month = timelineTime.month;
        redraw = false;
        //Stop the callbacks since we can be adding and removing a lot of items
  
        for (var i = 0; i < visibleMalaiseLocations.values.length; i++) {
          var locationEntity = visibleMalaiseLocations.values[i];
          var stationId = locationEntity.properties.stationId;
          var temperature = sampleTypes[stationId][timelineTime.year]
            && sampleTypes[stationId][timelineTime.year][timelineTime.month];
          var wasShowing = locationEntity.show;
  
          if (temperature < 999) {
            locationEntity.color = stationColorScale(temperature, stationEntity.color);
            locationEntity.properties.temperature = temperature;
            locationEntity.show = true;
  
            //Add to the selection group if under selector
            if (selector.show && !wasShowing && stationSelected(locationEntity, rectangleCoordinates, stationCartographic)) {
              //Covers case where we zoom out of selection area
              if (!selectedLocations.contains(stationEntity)) {
                selectedLocations.add(stationEntity);
              }
            }
          }
          else {
            stationEntity.show = false;
            selectedLocations.remove(stationEntity);
          }
        }
  
        //Update the stations in case no entities were added or removed. Call is throttled so can't double call.
        // if (selector.show) {
        //   updateHistogramThrottled(selectedLocations);
        // }
  
        //Updated selected temperature
        var selectedId = _.get(viewer, 'selectedEntity.properties.stationId');
  
        if (selectedId) {
          var selectedTemperature = _.get(sampleTypes, [selectedId, timelineTime.year, timelineTime.month]);
  
          if (selectedTemperature > 999) {
            selectedTemperature = 'N/A';
          }
  
          $infoBox.find('.cesium-infoBox-iframe').contents().find('tr:last td').text(selectedTemperature);
        }
      }
    });
  }
  
  function setupEventListeners(sampleLocations) {
    var stationEntities = sampleLocations.entities.values;
    var stationEntitiesLength = stationEntities.length;
    var screenSpaceEventHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  
    var cartesian = new Cesium.Cartesian3();
    var scratchCartographic = new Cesium.Cartographic();
    var scratchJulian = new Cesium.JulianDate();
    var center = new Cesium.Cartographic();
    var firstPoint = new Cesium.Cartographic();
    var firstPointSet = false;
    var mouseDown = false;
  
    var camera = viewer.camera;
  
    //SECTION - Build spatial hash
    spatialHash = new SpatialHash(4);
  
    for (var i = 0; i < stationEntitiesLength; i++) {
      var position = Cesium.Cartographic.fromCartesian(stationEntities[i]._position._value);
      var entry = {
        x: convertLongitude(position.longitude),
        y: convertLatitude(position.latitude),
        width: 30 / 111111, //30 meters
        height: 30 / 111111,
        id: stationEntities[i].id
      };
  
      spatialHash.insert(entry);
    }
  
    var spatialSelector = {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
  
    //SECTION - keyboard and mouse listeners
    $(document).on('keydown', function onKeydown(event) {
      if (event.keyCode === 32 && event.target.type !== 'search') {
        viewer.clock.shouldAnimate = !viewer.clock.shouldAnimate;
      }
    });
  
    $(".cesium-navigation-help-button").on('keydown', function onKeydown(event) {
      if (event.keyCode === 32) {
        event.preventDefault();
      }
    });
  
    //Draw the selector while the user drags the mouse while holding shift
    screenSpaceEventHandler.setInputAction(function drawSelector(movement) {
      if (!mouseDown) {
        return;
      }
  
      cartesian = camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid, cartesian);
  
      if (cartesian) {
        //mouse cartographic
        scratchCartographic = Cesium.Cartographic.fromCartesian(cartesian, Cesium.Ellipsoid.WGS84, scratchCartographic);
  
        if (!firstPointSet) {
          Cesium.Cartographic.clone(scratchCartographic, firstPoint);
          firstPointSet = true;
        }
        else {
          rectangleCoordinates.east = Math.max(scratchCartographic.longitude, firstPoint.longitude);
          rectangleCoordinates.west = Math.min(scratchCartographic.longitude, firstPoint.longitude);
          rectangleCoordinates.north = Math.max(scratchCartographic.latitude, firstPoint.latitude);
          rectangleCoordinates.south = Math.min(scratchCartographic.latitude, firstPoint.latitude);
  
          //Don't draw if rectangle has 0 size. Will cause Cesium to throw an error.
          selector.show = rectangleCoordinates.east !== rectangleCoordinates.west || rectangleCoordinates.north !== rectangleCoordinates.south;
          selectedLocations.removeAll();
  
          //Get stations under selector
          center = Cesium.Rectangle.center(rectangleCoordinates, center);
          spatialSelector.x = convertLongitude(center.longitude);
          spatialSelector.y = convertLatitude(center.latitude);
          spatialSelector.width = convertLongitude(rectangleCoordinates.width) - 1800;
          spatialSelector.height = convertLatitude(rectangleCoordinates.height) - 900;
          var selectedItems = _.map(spatialHash.retrieve(spatialSelector), 'id');
  
          for (var i = 0; i < selectedItems.length; i++) {
            var stationEntity = sampleLocations.entities.getById(selectedItems[i]);
  
            if (stationEntity.show && !selectedLocations.contains(stationEntity)
              && stationSelected(stationEntity, rectangleCoordinates, scratchCartographic)) {
              selectedLocations.add(stationEntity);
            }
          }
  
          //updateHistogramThrottled(selectedLocations);
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE, Cesium.KeyboardEventModifier.SHIFT);
  
    screenSpaceEventHandler.setInputAction(function startClickShift() {
      mouseDown = true;
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.KeyboardEventModifier.SHIFT);
  
    var endClickShift = function endClickShift() {
      mouseDown = false;
      firstPointSet = false;
    };
  
    screenSpaceEventHandler.setInputAction(endClickShift, Cesium.ScreenSpaceEventType.LEFT_UP, Cesium.KeyboardEventModifier.SHIFT);
    screenSpaceEventHandler.setInputAction(endClickShift, Cesium.ScreenSpaceEventType.LEFT_UP);
  
    //Hide the selector by clicking anywhere
    screenSpaceEventHandler.setInputAction(function hideSelector() {
      selector.show = false;
      selectedLocations.removeAll();
      updateHistogramThrottled(selectedLocations);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  
    var getSelectorLocation = new Cesium.CallbackProperty(function getSelectorLocation(time, result) {
      return Cesium.Rectangle.clone(rectangleCoordinates, result);
    }, false);
  
    var getSelectorHeight = new Cesium.CallbackProperty(function getSelectorHeight() {
      return Cesium.CesiumMath.clamp(camera._positionCartographic.height - 3500000, 0, 100000);
    }, false);
  
    var selectorRectangle = {
      coordinates: getSelectorLocation,
      height: getSelectorHeight
    };
  
    if (config.fancySelector) {
      _.extend(selectorRectangle, {
        material: new Cesium.GridMaterialProperty()
      })
    }
    else {
      _.extend(selectorRectangle, {
        fill: false,
        outline: true,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3
      })
    }
  
    selector = viewer.entities.add({
      selectable: false,
      show: false,
      rectangle: selectorRectangle
    });
  
    updateHistogramThrottled = _.throttle(function (collection) {
      updateHistogram(_.map(collection.values, 'properties.temperature'));
    }, 200);
  
    var cameraPositionLog;
    var previousLogged;
  
    //SECTION - camera movement callbacks
    camera.moveStart.addEventListener(function () {
      cameraMoving = true;
      if (config.server) {
        cameraPositionLog = setInterval(function () {
          if (!Cesium.Cartographic.equals(previousLogged, camera.positionCartographic)) {
            log.info(camera.positionCartographic);
            previousLogged = Cesium.Cartographic.clone(camera.positionCartographic, scratchCartographic);
          }
        }, 200);
      }
    });
  
    camera.moveEnd.addEventListener(function () {
      cameraMoving = false;
      if (config.server) {
        clearInterval(cameraPositionLog);
      }
    });
  
    //SECTION - Log fov to use in possible future calculations
    if (config.server) {
      log.info('fov: ' + viewer.camera.frustum.fov);
    }
  
    //SECTION - timeline callbacks
    $('.cesium-viewer-timelineContainer')
      .on('mousemove', function (e) {
        var timelineX = e.pageX - viewer.timeline._topDiv.getBoundingClientRect().left;
        var hoverSeconds = timelineX * viewer.timeline._timeBarSecondsSpan / viewer.timeline._topDiv.clientWidth;
  
        $('#timeline-tooltip')
          .fadeIn(200)
          .text(dateFormatter(Cesium.JulianDate.addSeconds(viewer.timeline._startJulian, hoverSeconds, scratchJulian)))
          .css({left: Math.min(e.pageX, viewer.scene.canvas.width - 35) - 35});
      })
      .on('mouseleave', function () {
        $('#timeline-tooltip').fadeOut(200);
      });
  
    //Initial drawing of points
    updateVisibleStations(sampleLocations, spatialSelector);
  }
  
  function updateVisibleStations(sampleLocations, spatialSelector) {
    //Get the frustum height in degrees
    var frustumHeight = 2 * viewer.camera.positionCartographic.height * Math.tan(viewer.camera.frustum.fov * 0.5) / 111111;
    var frustumWidth = frustumHeight * Math.max(viewer.camera.frustum.aspectRatio, 1.5);
  
    spatialSelector.x = convertLongitude(viewer.camera.positionCartographic.longitude);
    spatialSelector.y = convertLatitude(viewer.camera.positionCartographic.latitude);
    spatialSelector.width = Cesium.CesiumMath.clamp(Math.round(frustumWidth) * 10, 0, 1800);
    spatialSelector.height = Cesium.CesiumMath.clamp(Math.round(frustumHeight) * 10, 0, 900);
  
    var selectedIds = spatialHash.retrieve(spatialSelector);
    var secondarySelectedIds;
  
    //Handles frustum crossing anti-meridian
    var remainingLeft = (spatialSelector.width - spatialSelector.x * 2) / 2;
    var remainingRight = (spatialSelector.width - ((3600 - spatialSelector.x) * 2)) / 2;
  
    if (remainingLeft > 0) {
      spatialSelector.width = remainingLeft;
      spatialSelector.x = 3600 - remainingLeft / 2;
      secondarySelectedIds = spatialHash.retrieve(spatialSelector);
    }
    else if (remainingRight > 0) {
      spatialSelector.width = remainingRight;
      spatialSelector.x = remainingRight / 2;
      secondarySelectedIds = spatialHash.retrieve(spatialSelector);
    }
  
    visibleMalaiseLocations.removeAll();
  
    //Add visible stations to designated entity collection and hide all other entities
    var inFrustum = _.chain(selectedIds)
      .unionBy(secondarySelectedIds, 'id')
      .map(function (selected) {
        return visibleMalaiseLocations.add(sampleLocations.entities.getById(selected.id)).id;
      })
      .value();
  
    _.chain(spatialHash.list)
      .map('id')
      .difference(inFrustum)
      .map(function (id) {
        sampleLocations.entities.getById(id).show = false;
      })
      .value();
  
    redraw = true;
  }
  
  function convertLongitude(longitude) {
    return Math.round((Cesium.CesiumMath.toDegrees(longitude) + 180) * 10);
  }
  
  function convertLatitude(latitude) {
    return Math.round((Cesium.CesiumMath.toDegrees(latitude) + 90) * 10);
  }
  
  function stationSelected(station, rectangleSelector, stationCartographic) {
    stationCartographic = Cesium.Cartographic.fromCartesian(station._position._value, Cesium.Ellipsoid.WGS84, stationCartographic);
  
    return stationCartographic.longitude >= rectangleSelector.west && stationCartographic.longitude <= rectangleSelector.east
      && stationCartographic.latitude <= rectangleSelector.north && stationCartographic.latitude >= rectangleSelector.south;
  }
  
  function enableVisualization() {
    $('#loadingData').show().delay(1000).fadeOut();
    viewer.scene.screenSpaceCameraController.enableInputs = true;
  }
  
  function getModules() {
    return {
      BuildModuleUrl: require('cesium/Source/Core/buildModuleUrl'),
      BingMapsApi: require('cesium/Source/Core/BingMapsApi'),
      ArcGisMapServerImageryProvider: require('cesium/Source/Scene/ArcGisMapServerImageryProvider'),
      Viewer: require('cesium/Source/Widgets/Viewer/Viewer'),
      RectangleGeometry: require('cesium/Source/Core/RectangleGeometry'),
      GridImageryProvider: require('cesium/Source/Scene/GridImageryProvider'),
      Primitive: require('cesium/Source/Scene/Primitive'),
      PerInstanceColorAppearance: require('cesium/Source/Scene/PerInstanceColorAppearance'),
      ColorGeometryInstanceAttribute: require('cesium/Source/Core/ColorGeometryInstanceAttribute'),
      GeometryInstance: require('cesium/Source/Core/GeometryInstance'),
      GeoJsonDataSource: require('cesium/Source/DataSources/GeoJsonDataSource'),
      Clock: require('cesium/Source/Core/Clock'),
      JulianDate: require('cesium/Source/Core/JulianDate'),
      GregorianDate: require('cesium/Source/Core/GregorianDate'),
      ClockRange: require('cesium/Source/Core/ClockRange'),
      Color: require('cesium/Source/Core/Color'),
      CallbackProperty: require('cesium/Source/DataSources/CallbackProperty'),
      VerticalOrigin: require('cesium/Source/Scene/VerticalOrigin'),
      NearFarScalar: require('cesium/Source/Core/NearFarScalar'),
      Rectangle: require('cesium/Source/Core/Rectangle'),
      ScreenSpaceEventHandler: require('cesium/Source/Core/ScreenSpaceEventHandler'),
      ScreenSpaceEventType: require('cesium/Source/Core/ScreenSpaceEventType'),
      KeyboardEventModifier: require('cesium/Source/Core/KeyboardEventModifier'),
      Cartesian3: require('cesium/Source/Core/Cartesian3'),
      Cartographic: require('cesium/Source/Core/Cartographic'),
      Ellipsoid: require('cesium/Source/Core/Ellipsoid'),
      CesiumMath: require('cesium/Source/Core/Math'),
      EntityCollection: require('cesium/Source/DataSources/EntityCollection'),
      SceneMode: require('cesium/Source/Scene/SceneMode'),
      Timeline: require('cesium/Source/Widgets/Timeline/Timeline'),
      GridMaterialProperty: require('cesium/Source/DataSources/GridMaterialProperty')
    };
  }
  
  //main
  (function main() {
    asyncLoadJson(config.grid, function (gridLocations) {
      colorGlobe(gridLocations);
    });
  
    asyncLoadJson(config.temperatures, function (sampleTypes) {
      asyncLoadJson(config.locations, function (sampleLocationsGeoJson) {
          Cesium.GeoJsonDataSource.load(sampleLocationsGeoJson).then(function loadStations(sampleLocations) {
            //createHistogram();
            //fcreateLegend();
            console.log('yes, we have:')
            console.log(gridLocations);
            populateGlobe(sampleTypes, sampleLocations);
            
            setupEventListeners(sampleLocations);
            dataLoaded = true;
            if (firstMessageLoaded || !config.server) {
              enableVisualization();
            }
          });
      });  
    });
  })();
  
  function asyncLoadJson(filename, cb) {
    fetch(filename)
  
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        return cb(data);
      })
      .catch(function (err) {
        console.log(filename, err)
      });
  }
