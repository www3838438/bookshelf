'use strict';

const _ = require('lodash');
const Promise = require('bluebird');

// Virtuals Plugin
// Allows getting/setting virtual (computed) properties on model instances.
// -----
module.exports = function (Bookshelf) {
  const proto = Bookshelf.Model.prototype;
  const Model = Bookshelf.Model.extend({
    outputVirtuals: true,

    // If virtual properties have been defined they will be created
    // as simple getters on the model.
    constructor: function (attributes, options) {
      proto.constructor.apply(this, arguments);
      const virtuals = this.virtuals;
      if (_.isObject(virtuals)) {
        for (const virtualName in virtuals) {
          let getter, setter;
          if (virtuals[virtualName].get) {
            getter = virtuals[virtualName].get;
            setter = virtuals[virtualName].set
              ? virtuals[virtualName].set
              : undefined;
          } else {
            getter = virtuals[virtualName];
          }
          Object.defineProperty(this, virtualName, {
            enumerable: true,
            get: getter,
            set: setter
          });
        }
      }
    },

    // Passing `{virtuals: true}` or `{virtuals: false}` in the `options`
    // controls including virtuals on function-level and overrides the
    // model-level setting
    toJSON: function(options) {
      let attrs = proto.toJSON.call(this, options);
      if (options && options.omitNew && this.isNew()) {
        return attrs;
      }
      if (!options || options.virtuals !== false) {
        if ((options && options.virtuals === true) || this.outputVirtuals) {
          attrs = _.extend(attrs, getVirtuals(this, options && options.virtualParams));
        }
      }
      return attrs;
    },

    // Allow virtuals to be fetched like normal properties
    get: function(attr) {
      if (_.isObject(this.virtuals) && this.virtuals[attr]) {
        return getVirtual.apply(undefined, [this, attr].concat(Array.from(arguments).slice(1)));
      }
      return proto.get.apply(this, arguments);
    },

    // Allow virtuals to be set like normal properties
    set: function(key, value, options) {
      if (key == null) {
        return this;
      }

      // Determine whether we're in the middle of a patch operation based on the
      // existence of the `patchAttributes` object.
      const isPatching = this.patchAttributes != null;

      // Handle `{key: value}` style arguments.
      if (_.isObject(key)) {
        const nonVirtuals = _.omitBy(key, _.bind(setVirtual, this));
        if (isPatching) {
          _.extend(this.patchAttributes, nonVirtuals);
        }
        // Set the non-virtual attributes as normal.
        return proto.set.call(this, nonVirtuals, options);
      }

      // Handle `"key", value` style arguments for virtual setter.
      if (setVirtual.call(this, value, key)) {
        return this;
      }

      // Handle `"key", value` style assignment call to be added to patching
      // attributes if set("key", value, ...) called from inside a virtual setter.
      if (isPatching) {
        this.patchAttributes[key] = value;
      }

      return proto.set.apply(this, arguments);
    },

    // Override `save` to keep track of state while doing a `patch` operation.
    save: function(key, value, options) {
      let attrs;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (key == null || typeof key === "object") {
        attrs = key && _.clone(key) || {};
        options = _.clone(value) || {};
      } else {
        (attrs = {})[key] = value;
        options = options ? _.clone(options) : {};
      }

      // Determine whether which kind of save we will do, update or insert.
      options.method = this.saveMethod(options);

      // Check if we're going to do a patch, in which case deal with virtuals now.
      if (options.method === 'update' && options.patch) {

         // Extend the model state to collect side effects from the virtual setter
         // callback. If `set` is called, this object will be updated in addition
         // to the normal `attributes` object.
         this.patchAttributes = {};

         // Any setter could throw. We need to reject `save` if they do.
         try {

           // Check if any of the patch attributes are virtuals. If so call their
           // setter. Any setter that calls `this.set` will be modifying
           // `this.patchAttributes` instead of `this.attributes`.
           _.each(attrs, (function (value, key) {

             if (setVirtual.call(this, value, key)) {
               // This was a virtual, so remove it from the attributes to be
               // passed to `Model.save`.
               delete attrs[key];
             }

           }).bind(this));

           // Now add any changes that occurred during the update.
           _.extend(attrs, this.patchAttributes);
         } catch (e) {
           return Promise.reject(e);
         } finally {
           // Delete the temporary object.
           delete this.patchAttributes;
         }
      }

      return proto.save.call(this, attrs, options);
    }
  });

  // Lodash methods that we want to implement on the Model.
  const modelMethods = ['keys', 'values', 'toPairs', 'invert', 'pick', 'omit'];

  // Mix in each Lodash method as a proxy to `Model#attributes`.
  _.each(modelMethods, function(method) {
    Model.prototype[method] = function() {
      return _[method].apply(_, [_.extend({}, this.attributes, getVirtuals(this))].concat(Array.from(arguments)));
    };
  });

  function getVirtual(model, virtualName) {
    if (_.isObject(model.virtuals) && model.virtuals[virtualName]) {
      const virtualParams = Array.from(arguments).slice(2);

      return model.virtuals[virtualName].get
        ? model.virtuals[virtualName].get.apply(model, virtualParams)
        : model.virtuals[virtualName].apply(model, virtualParams);
    }
  }

  function getVirtuals(model, params) {
    const attrs = {};
    if (model.virtuals != null) {
      for (const virtualName in model.virtuals) {
        const paramsForVirtual = typeof(params) === 'object' && params !== null ? params[virtualName] : undefined;
        attrs[virtualName] = getVirtual(model, virtualName, paramsForVirtual);
      }
    }
    return attrs;
  }

  function setVirtual(value, key) {
    const virtual = this.virtuals && this.virtuals[key];
    if (virtual) {
      if (virtual.set) {
        virtual.set.call(this, value);
      }
      return true;
    }
  }

  Bookshelf.Model = Model;
};
