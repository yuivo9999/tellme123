/* School role separation hotfix */
(function () {
  'use strict';
  if (typeof window.isSchoolFolded === 'function') {
    window.isSchoolFolded = function () { return false; };
  }
  if (typeof window.scState === 'function') {
    var originalScState = window.scState;
    window.scState = function () {
      var sc = originalScState();
      if (!sc || typeof sc !== 'object') return sc;
      sc.principal = sc.principal || {};
      sc.principal.folded = false;
      sc.finished = sc.finished || {};
      var hasRealTeacher = Array.isArray(sc.teachers) && sc.teachers.some(function (t) {
        return !!(t && t.raw && String(t.raw).trim());
      });
      if (!hasRealTeacher) {
        delete sc.finished.t0;
        delete sc.finished.teacher;
      }
      return sc;
    };
  }
})();
