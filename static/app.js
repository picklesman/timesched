'use strict';

/* global moment */

var timesched = angular
  .module('timesched', ['ui.bootstrap', 'ui.sortable', 'ui.slider'])
  .config(function($locationProvider) {
    $locationProvider.html5Mode(true);
  });

(function() {
  var TWEET_PREFIX = 'Let\'s meet at ';
  var MAIL_SUBJECT = 'Scheduled Meeting';
  var MAIL_HEADER = '\n\n';
  var MAIL_FOOTER = '';
  var SELECTABLES = [];
  var WEEKEND_INFO = {};
  var SELECTABLES_BY_NAME = {};
  var SELECTABLES_BY_KEY = {};

  function uniq(tokens) {
    var found = {};
    var rv = [];
    for (var i = 0; i < tokens.length; i++) {
      var k = tokens[i];
      if (found['::' + k] === undefined) {
        rv.push(tokens[i]);
        found['::' + k] = true;
      }
    }
    return rv;
  }

  function normalizeZoneName(zoneName) {
    return zoneName.toLowerCase().replace(/^\s+|\s+$/g, '');
  }

  function zoneExists(input) {
    return !!SELECTABLES_BY_NAME[normalizeZoneName(input)];
  }

  function lookupTimeZoneState(input) {
    var zone = SELECTABLES_BY_NAME[normalizeZoneName(input)];
    if (!zone) {
      zone = SELECTABLES_BY_KEY[input];
      if (!zone)
        return null;
    }
    var m;
    try {
      m = moment.tz(normalizeZoneName(zone.z));
    } catch (e) {
    }
    return m !== null ? new TimeZoneState(m, zone) : null;
  }

  function getLocaleTimeZoneState() {
    var tried = {};

    var now = Date.now();
    function makeKey(id) {
      return [0, 4, 8, -5 * 12, 4 - 5 * 12, 8 - 5 * 12].map(function(months) {
        var m = moment(now + months * 30 * 24 * 60 * 60 * 1000);
        if (id)
          m.tz(id);
        return m.format('DDHH');
      }).join(' ');
    }

    var thisKey = makeKey();

    for (var key in SELECTABLES_BY_KEY) {
      var sel = SELECTABLES_BY_KEY[key];
      if (sel.t !== 'T' || !sel.C || tried[sel.z] !== undefined)
        continue;
      tried[sel.z] = true;
      if (thisKey === makeKey(sel.z))
        return lookupTimeZoneState(sel.k);
    }

    return null;
  }

  timesched.setTimezoneData = function(data) {
    SELECTABLES = [];
    WEEKEND_INFO = {};
    SELECTABLES_BY_NAME = {};
    SELECTABLES_BY_KEY = {};

    for (var i = 0; i < data.selectables.length; i++) {
      var sel = data.selectables[i];
      var s = sel.d.toLowerCase().replace(/[^\s\w]/g, '');
      if (sel.t == 'T') {
        try {
          var zones = moment.tz(sel.z)._z.zones;
          for (var j = 0; j < zones.length; j++) {
            if (zones[j].letters === '%s')
              continue;
            s += ' ' + zones[j].letters.replace(/[^\s\w]/g, ' ');
            s += ' ' + zones[j].letters;
          }
        } catch (e) {
          continue;
        }
      }
      sel.tokens = uniq(s.split(/\s+/g));
      SELECTABLES.push(sel);
      SELECTABLES_BY_NAME[sel.d.toLowerCase()] = sel;
      SELECTABLES_BY_KEY[sel.k] = sel;
    }
    WEEKEND_INFO = data.weekends;
  };

  function getWeekendInfo(country) {
    var start = WEEKEND_INFO.start[country] || WEEKEND_INFO.start['001'];
    var end = WEEKEND_INFO.end[country] || WEEKEND_INFO.end['001'];
    return [start, end];
  }

  function isWeekend(info, day) {
    return day >= info[0] || day % 6 <= info[1];
  }

  function TimeZoneState(m, zone) {
    this.tz = m.tz();
    this.urlKey = zone.k;
    this.offset = 0;
    this.timezoneShortName = zone.n;
    this.timezoneName = zone.d;
    this.weekendInfo = getWeekendInfo(zone.c || null);

    this._cacheDay = null;
    this._cacheTZ = null;
    this.update(new Date(), null);
  }

  TimeZoneState.prototype.update = function(day, homeZone) {
    var reftz = homeZone ? homeZone.tz : this.tz;
    var start = moment.tz(day, reftz).startOf('day');
    var ptr = start.clone().tz(this.tz);
    var offset = (start.zone() - ptr.zone()) / 60;
    var cacheDay = moment(day).format('YYYY-MM-DD');

    if (cacheDay === this._cacheDay && reftz === this._cacheTZ) {
      return;
    }

    this.dayStart = ptr.clone();
    this.homeOffset = (offset > 0 ? '+' : '') + offset;
    this.timezoneOffsetInfo = ptr.format('[UTC] Z');
    this.utcOffset = ptr.zone();
    this.timezoneAbbr = ptr.format('z');
    this.isHome = homeZone === null || homeZone.urlKey === this.urlKey;

    this.timeCells = [];
    for (var i = 0; i < 24; i++) {
      if (i !== 0)
        ptr.add('hours', 1);
      this.timeCells.push({
        hour: parseInt(ptr.format('H'), 10),
        hourFormat: ptr.format('H'),
        minute: parseInt(ptr.format('m'), 10),
        minuteFormat: ptr.format('mm'),
        isWeekend: isWeekend(this.weekendInfo, ptr.day()),
        tooltip: ptr.format('LLLL (z)')
      });
    }

    if (ptr.zone() !== this.utcOffset) {
      var endAbbr = ptr.format('z');
      var endOffsetInfo = ptr.format('[UTC] Z');
      if (endAbbr != this.timezoneAbbr)
        this.timezoneAbbr += '/' + endAbbr;
      if (endOffsetInfo != this.timezoneOffsetInfo)
        this.timezoneOffsetInfo += '/' + endOffsetInfo;
    }

    this._cacheDay = cacheDay;
    this._cacheTZ = reftz;
    this.updateClock();
  };

  TimeZoneState.prototype.getRangeStart = function(range) {
    return this.dayStart.clone().add('minutes', range[0]);
  };

  TimeZoneState.prototype.getRangeEnd = function(range) {
    return this.dayStart.clone().add('minutes', range[1]);
  };

  TimeZoneState.prototype.updateClock = function() {
    var now = moment.tz(this.tz);
    var oldH = this.clockHour;
    var oldM = this.clockMinute;
    var oldD = this.clockDay;
    this.clockHour = now.format('H');
    this.clockMinute = now.format('mm');
    this.clockDay = now.format('ddd, DD MMM');
    return this.clockHour !== oldH || this.clockMinute !== oldM ||
      this.clockDay != oldD;
  };

  timesched.controller('TimezoneCtrl', function($scope, $location,
                                                datepickerConfig, $element,
                                                $timeout) {
    var skipSave = false;
    $scope.day = new Date();
    $scope.isToday = true;
    $scope.zones = [];
    $scope.homeZone = null;
    $scope.currentZone = null;
    $scope.ready = false;
    $scope.timeRange = [600, 1020];
    $scope.scheduleMeeting = false;
    $scope.meetingSummary = '';
    $scope.markWeekends = true;
    $scope.showClocks = true;

    // make the datepicker show monday by default
    datepickerConfig.startingDay = 1;

    $scope.addInputZone = function() {
      if ($scope.addZone($scope.currentZone))
        $scope.currentZone = '';
    };

    $scope.addZone = function(zoneName) {
      var zoneState = lookupTimeZoneState(zoneName);
      if (zoneState === null)
        return false;
      $scope.zones.push(zoneState);
      $scope.updateZones();
      return true;
    };

    $scope.setAsHome = function(zone) {
      $scope.homeZone = zone;
      $scope.updateZones();
      $scope.saveState();
    };

    $scope.toggleMarkWeekends = function() {
      $scope.markWeekends = !$scope.markWeekends;
      $scope.saveState();
    };

    $scope.toggleClocks = function() {
      $scope.showClocks = !$scope.showClocks;
      $scope.syncClockPointer();
    };

    $scope.goToToday = function() {
      $timeout(function() {
        // dismiss the timezone box
        $('body').trigger('click');
        if ($scope.homeZone === null) {
          $scope.day = new Date();
        } else {
          $scope.day = moment(moment.tz(
            $scope.homeZone.tz).format('YYYY-MM-DD') + 'T00:00:00').toDate();
        }
        $scope.$apply();
      });
    };

    $scope.removeZone = function(zone) {
      for (var i = 0, n = $scope.zones.length; i < n; i++) {
        if ($scope.zones[i] !== zone)
          continue;
        $scope.zones.splice(i, 1);
        if ($scope.homeZone === zone) {
          $scope.homeZone = null;
          $scope.updateZones();
        }
        break;
      }
    };

    $scope.sortByOffset = function() {
      $scope.sortByFunc(function(a, b) {
        return b.utcOffset - a.utcOffset;
      });
    };

    $scope.sortByName = function() {
      $scope.sortByFunc(function(a, b) {
        a = a.timezoneName.toLowerCase();
        b = b.timezoneName.toLowerCase();
        return a == b ? 0 : a < b ? -1 : 1;
      });
    };

    $scope.sortByFunc = function(sortFunc) {
      var copy = $scope.zones.slice(0);
      copy.sort(sortFunc);
      $scope.zones = copy;
    };

    $scope.reverse = function() {
      var newList = [];
      for (var i = $scope.zones.length - 1; i >= 0; i--)
        newList.push($scope.zones[i]);
      $scope.zones = newList;
    };

    $scope.clearList = function() {
      $scope.zones = [];
      $scope.saveState(true);
    };

    $scope.updateClocks = function() {
      var rv = false;
      $scope.zones.forEach(function(zone) {
        if (zone.updateClock())
          rv = true;
      });
      var wasToday = $scope.isToday;
      $scope.checkForToday();
      return rv || (wasToday != $scope.isToday);
    };

    $scope.checkForToday = function() {
      if ($scope.homeZone === null)
        return;
      var now = moment.tz($scope.homeZone.tz).format('YYYY-MM-DD');
      var dayStart = moment($scope.day).format('YYYY-MM-DD');
      $scope.isToday = now == dayStart;
    };

    $scope.updateZones = function() {
      if (!$scope.zones.length)
        return;
      if ($scope.homeZone === null) {
        $scope.homeZone = $scope.zones[0];
        $scope.checkForToday();
      }
      $scope.zones.forEach(function(zone) {
        zone.update($scope.day, $scope.homeZone);
      });
    };

    $scope.$watch('day', function() {
      $scope.updateZones();
      $scope.saveState();
    });

    $scope.$watch('scheduleMeeting', function() {
      $scope.saveState();
    });

    $scope.$watch('timeRange', function() {
      $scope.syncClockPointer();
      $scope.syncSlider();
      $scope.saveState();
    });

    $scope.$watchCollection('zones', function() {
      $scope.syncClockPointer();
      $scope.syncSlider();
      $scope.saveState();
    });

    $scope.syncClockPointer = function() {
      var ptr = $('.clock-pointer > .actual-pointer', $element);
      if ($scope.homeZone === null || !$scope.isToday || !$scope.showClocks) {
        ptr.hide();
      } else {
        ptr.css({
          height: $scope.zones.length * 50 + 'px',
          left: ((parseInt($scope.homeZone.clockHour, 10) * 60 +
                  parseInt($scope.homeZone.clockMinute, 10)) / 1440) * 100 + '%'
        }).show();
      }
    };

    $scope.syncSlider = function() {
      if (!$scope.scheduleMeeting)
        return;

      $('.ui-slider-range', $element).css({
        height: (32 + $scope.zones.length * 50) + 'px'
      });
    };

    $scope.saveState = function(doNotReplace) {
      if (!$scope.ready)
        return;
      if (skipSave) {
        skipSave = false;
        return;
      }
      var buf = [];
      for (var i = 0; i < $scope.zones.length; i++) {
        var zone = $scope.zones[i];
        var item = zone.urlKey;
        if (zone.isHome)
          item += '!';
        buf.push(item);
      }
      var params = {};
      params.date = moment($scope.day).format('YYYY-MM-DD');
      if (buf.length > 0)
        params.tz = buf.join(',');
      if ($scope.scheduleMeeting)
        params.range = $scope.timeRange[0] + ',' + $scope.timeRange[1];
      if (!$scope.markWeekends)
        params.weekends = '0';
      if (params.tz != $location.search.tz ||
          params.date != $location.search.date ||
          params.range != $location.search.range ||
          params.weekends != $location.search.weekends) {
        $location.search(params);
        if (!doNotReplace)
          $location.replace();
      }

      if ($scope.scheduleMeeting)
        $scope.updateMeetingSummary();
    };

    $scope.updateMeetingSummary = function() {
      $scope.meetingSummary = $scope.makeTableSummary();
    };

    $scope.makeTableSummary = function() {
      var lines = [];
      var fmt = 'HH:mm   ddd, MMM D YYYY';
      for (var i = 0; i < $scope.zones.length; i++) {
        var zone = $scope.zones[i];
        var start = zone.getRangeStart($scope.timeRange);
        var end = zone.getRangeEnd($scope.timeRange);
        if (i > 0)
          lines.push('');
        lines.push(zone.timezoneName + '  [' + start.format('z; [UTC]ZZ') +
          (start.zone() != end.zone() ? '; timezone change' : '') + ']');
        lines.push(start.format(fmt));
        lines.push(end.format(fmt));
      }
      return lines.join('\n');
    };

    $scope.getMailBody = function() {
      return MAIL_HEADER + $scope.makeTableSummary() + MAIL_FOOTER;
    };

    $scope.sendMeetingMail = function() {
      location.href = 'mailto:?' +
        'subject=' + encodeURIComponent(MAIL_SUBJECT) + '&' +
        'body=' + encodeURIComponent($scope.getMailBody());
    };

    $scope.sendMeetingMailViaGMail = function() {
      window.open('https://mail.google.com/mail/?view=cm&' +
        'to=&su=' + encodeURIComponent(MAIL_SUBJECT) + '&' +
        'body=' + encodeURIComponent($scope.getMailBody()), '_blank');
    };

    $scope.tweet = function() {
      var times = [];
      for (var i = 0; i < $scope.zones.length; i++) {
        var zone = $scope.zones[i];
        var start = zone.getRangeStart($scope.timeRange);
        var end = zone.getRangeEnd($scope.timeRange);
        times.push(start.format('HH:mm') + '-' +
                   end.format('HH:mm') + ' ' + start.format('z'));
      }
      window.open('https://www.twitter.com/share?' +
        'text=' + encodeURIComponent(TWEET_PREFIX + times.join(', ')) + '&' +
        'url=' + encodeURIComponent(document.location.href), '_blank');
    };

    $scope.zonesDifferInURL = function(urlZones) {
      if (urlZones.length != $scope.zones.length)
        return true;
      for (var i = 0; i < urlZones.length; i++) {
        if (urlZones[i] !== $scope.zones[i].urlKey)
          return true;
      }
      return false;
    };

    $scope.syncWithURL = function() {
      var allZones = [];
      var homeZone = null;
      var params = $location.search();
      var zones = (params.tz || '').split(',');
      var dateChanged = false;
      var setToToday = false;
      if (zones.length == 1 && zones[0] === '')
        zones = [];

      for (var i = 0; i < zones.length; i++) {
        var zoneName = zones[i];
        if (zoneName[zoneName.length - 1] == '!') {
          zoneName = zoneName.substr(0, zoneName.length - 1);
          homeZone = zoneName;
        }
        allZones.push(zoneName);
      }

      if (params.date) {
        var newDate = moment(params.date, 'YYYY-MM-DD');
        if (!moment(newDate).isSame(moment($scope.day))) {
          $scope.day = newDate.toDate();
          dateChanged = true;
        }
      } else {
        setToToday = true;
      }

      if (params.range) {
        var rangePieces = params.range.split(',');
        $scope.timeRange = [parseInt(rangePieces[0], 10),
                            parseInt(rangePieces[1], 10)];
        $scope.scheduleMeeting = true;
      } else {
        $scope.scheduleMeeting = false;
      }

      if (params.weekends == '0') {
        $scope.markWeekends = false;
      } else if (!params.weekends || params.weekends == '1') {
        $scope.markWeekends = true;
      }

      if (dateChanged || setToToday || $scope.zonesDifferInURL(allZones)) {
        $scope.homeZone = null;
        $scope.zones = [];

        if (homeZone === null && allZones.length > 0)
          homeZone = allZones[0];

        if (homeZone !== null)
          $scope.addZone(homeZone);
        for (i = 0; i < allZones.length; i++) {
          if (allZones[i] !== homeZone)
            $scope.addZone(allZones[i]);
        }

        $scope.sortByFunc(function(a, b) {
          var idx1 = allZones.indexOf(a.urlKey);
          var idx2 = allZones.indexOf(b.urlKey);
          return idx1 - idx2;
        });
        if (setToToday)
          $scope.goToToday();
        else
          $scope.checkForToday();
      }
    };

    $scope.$on('$locationChangeSuccess', $scope.syncWithURL);
    window.setTimeout(function() {
      $scope.ready = true;
      $scope.syncWithURL();

      // in case we did not find any zones try autodetection for
      // the current one.  If that succeeds we do not want to save
      // the state though, to keep the url clean.
      if ($scope.zones.length === 0) {
        var home = getLocaleTimeZoneState();
        if (home !== null) {
          skipSave = true;
          $scope.addZone(home.urlKey);
          $scope.$apply();
        }
      }

      $('div.loading').hide();
      $('div.contentwrapper').fadeIn('slow', function() {
        window.setInterval(function() {
          if ($scope.updateClocks()) {
            $scope.syncClockPointer();
            $scope.$apply();
          }
        }, 1000);
      });
    }, 100);
  });

  timesched.directive('timezone', function() {
    return {
      restrict: 'ACE',
      require: 'ngModel',
      scope: {
        ngModel: '='
      },
      link: function(scope, elm, attrs, ctrl) {
        var localChange = false;

        elm.typeahead({
          name: 'timezone',
          local: SELECTABLES,
          valueKey: 'd',
          limit: 6,
          engine: {compile: function() {
            return {
              render: function(context) {
                // TODO: escape just in case.
                var rv = '<p>' + context.d;
                try {
                  var now = moment.tz(context.z);
                  rv += '\u00a0<em>' + now.format('HH:mm') + '</em>';
                  rv += '\u00a0<small>' + now.format('z') + '</small>';
                } catch (e) {}
                return rv;
              }
            };
          }},
          template: 'dummy'
        });

        function updateScope() {
          var oldVal = elm.val();
          scope.$apply(function() {
            localChange = true;
            scope.ngModel = elm.val();
          });
          elm.val(oldVal);
        }

        elm.on('typeahead:selected', function() {
          ctrl.$setValidity('timezone', true);
          updateScope();
          elm.trigger('submit');
        });
        elm.on('typeahead:autocompleted', updateScope);

        elm.bind('input', function() {
          scope.$apply(function() {
            localChange = true;
            var value = elm.val();
            if (zoneExists(value)) {
              ctrl.$setValidity('timezone', true);
              scope.ngModel = value;
            } else {
              ctrl.$setValidity('timezone', false);
            }
          });
        });

        scope.$watch('ngModel', function(newVal) {
          if (localChange) {
            localChange = false;
            return;
          }
          elm.typeahead('setQuery', newVal || '');
        }, true);

        scope.$on('$destroy', function() {
          elm.typeahead('destroy');
        });
      }
    };
  });
})();
