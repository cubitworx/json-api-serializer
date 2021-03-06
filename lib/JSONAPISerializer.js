'use strict';

const _ = require('lodash');

/**
 * JSONAPISerializer class.
 *
 * @example
 * const JSONAPISerializer = require('json-api-serializer');
 *
 * // Create an instance of JSONAPISerializer with default settings
 * const Serializer = new JSONAPISerializer();
 *
 * @class JSONAPISerializer
 * @param {Object} [opts] Configuration options.
 */
module.exports = class JSONAPISerializer {
  constructor(opts) {
    this.opts = opts || {};
    this.schemas = {};
  }

  /**
   * Validate and apply default values to resource's configuration options.
   *
   * @method JSONAPISerializer#validateOptions
   * @private
   * @param {Object} options Configuration options.
   * @return {Object}
   */
  validateOptions(options) {
    return _.extend({
      id: 'id',
      blacklist: [],
      whitelist: [],
      links: {},
      relationships: {},
      topLevelLinks: {},
      topLevelMeta: {},
      // Deserialization options
      blacklistOnDeserialize: [],
      whitelistOnDeserialize: [],
    }, options || {});
  }

  /**
   * Validate and apply default values to the dynamic type object option.
   *
   * @method JSONAPISerializer#validateDynamicTypeOptions
   * @private
   * @param {Object} options dynamic type object option.
   * @return {Object}
   */
  validateDynamicTypeOptions(options) {
    return _.extend({
      topLevelLinks: {},
      topLevelMeta: {},
    }, options || {});
  }

  /**
   * Register a resource with its type, schema name, and configuration options.
   *
   * @method JSONAPISerializer#register
   * @param {string} type resource's type.
   * @param {string} [schema=default] schema name.
   * @param {Object} [options] Configuration options.
   */
  register(type, schema, options) {
    if (typeof schema === 'object') {
      options = schema;
      schema = 'default';
    }

    schema = schema || 'default';
    options = Object.assign({}, this.opts, options);

    _.set(this.schemas, [type, schema].join('.'), this.validateOptions(options));
  }

  /**
   * Serialze input data to a JSON API compliant response.
   * Input data can be a simple object or an array of objects.
   *
   * @see {@link http://jsonapi.org/format/#document-top-level}
   * @method JSONAPISerializer#serialize
   * @param {string|Object} type resource's type as string or a dynamic type options as object.
   * @param {Object|Object[]} data input data.
   * @param {string} [schema=default] resource's schema name.
   * @param {Object} [extraData] additional data that can be used in topLevelMeta options.
   * @return {Object} serialized data.
   */
  serialize(type, data, schema, extraData) {
    // Support optional arguments (schema)
    if (arguments.length === 3) {
      if (_.isPlainObject(schema)) {
        extraData = schema;
        schema = 'default';
      }
    }

    schema = schema || 'default';
    extraData = extraData || {};

    const included = [];
    let serializedData;
    let topLevelOption;

    if (_.isPlainObject(type)) { // Serialize data with the dynamic type
      const typeOption = this.validateDynamicTypeOptions(type);
      // Override top level data
      topLevelOption = { topLevelMeta: typeOption.topLevelMeta, topLevelLinks: typeOption.topLevelLinks };
      serializedData = this.serializeMixedData(typeOption, data, included, extraData);
    } else { // Serialize data with the defined type
      if (!this.schemas[type]) {
        throw new Error(`No type registered for ${type}`);
      }

      if (schema && !this.schemas[type][schema]) {
        throw new Error(`No schema ${schema} registered for ${type}`);
      }

      const resourceOpts = this.schemas[type][schema];
      topLevelOption = { topLevelMeta: resourceOpts.topLevelMeta, topLevelLinks: resourceOpts.topLevelLinks };
      serializedData = this.serializeData(type, data, resourceOpts, included, extraData);
    }


    return {
      jsonapi: {
        version: '1.0',
      },
      meta: this.processOptionsValues(data, extraData, topLevelOption.topLevelMeta, 'extraData'),
      links: this.processOptionsValues(data, extraData, topLevelOption.topLevelLinks, 'extraData'),
      data: serializedData,
      included: this.serializeIncluded(included),
    };
  }

  /**
   * Deserialize JSON API document data.
   * Input data can be a simple object or an array of objects.
   *
   * @method JSONAPISerializer#deserialize
   * @param {string|Object} type resource's type as string or an object with a dynamic type resolved from data.
   * @param {Object} data JSON API input data.
   * @param {string} [schema=default] resource's schema name.
   * @return {Object} deserialized data.
   */
  deserialize(type, data, schema) {
    schema = schema || 'default';

    if (!_.isPlainObject(type)) {
      if (!this.schemas[type]) {
        throw new Error(`No type registered for ${type}`);
      }

      if (schema && !this.schemas[type][schema]) {
        throw new Error(`No schema ${schema} registered for ${type}`);
      }
    } else {
      type = this.validateDynamicTypeOptions(type);
    }

    let deserializedData = {};

    if (data.data) {
      if (Array.isArray(data.data)) {
        deserializedData = data.data.map(resource => this.deserializeResource(type, resource, schema, data.included));
      } else {
        deserializedData = this.deserializeResource(type, data.data, schema, data.included);
      }
    }

    return deserializedData;
  }

  /**
   * Deserialize a single JSON API resource.
   * Input data must be a simple object.
   *
   * @method JSONAPISerializer#deserializeResource
   * @param {string|Object} type resource's type as string or an object with a dynamic type resolved from data.
   * @param {Object} data JSON API resource data.
   * @param {string} [schema=default] resource's schema name.
   * @return {Object} deserialized data.
   */
  deserializeResource(type, data, schema, included) {
    if (_.isPlainObject(type)) {
      type = (typeof type.type === 'function') ? type.type(data) : _.get(data, type.type);

      if (!type) {
        throw new Error(`No type can be resolved from data: ${JSON.stringify(data)}`);
      }

      if (!this.schemas[type]) {
        throw new Error(`No type registered for ${type}`);
      }

      schema = 'default';
    }

    const resourceOpts = this.schemas[type][schema];

    let deserializedData = {};
    // Deserialize id
    deserializedData[resourceOpts.id] = data.id || undefined;

    // whitelistOnDeserialize option
    if (resourceOpts.whitelistOnDeserialize.length > 0) {
      data.attributes = _.pick(data.attributes, resourceOpts.whitelistOnDeserialize);
    }

    // Remove unwanted keys (blacklistOnDeserialize option)
    if (resourceOpts.blacklistOnDeserialize.length > 0) {
      data.attributes = _.pick(data.attributes, _.difference(Object.keys(data.attributes), resourceOpts.blacklistOnDeserialize));
    }

    Object.assign(deserializedData, data.attributes);

    // Deserialize relationships
    if (data.relationships) {
      Object.keys(data.relationships).forEach((relationship) => {
        const value = data.relationships[relationship];
        // Support alternativeKey options for relationships
        let relationshipKey = relationship;
        if (resourceOpts.relationships[relationshipKey] && resourceOpts.relationships[relationshipKey].alternativeKey) {
          relationshipKey = resourceOpts.relationships[relationshipKey].alternativeKey;
        }

        if (_.isArray(value.data)) {
          deserializedData[relationshipKey] = value.data.map(d => (included
            ? this.deserializeIncluded(d.type, d.id, resourceOpts.relationships[relationshipKey], included)
            : d.id));
        } else {
          deserializedData[relationshipKey] = included
            ? this.deserializeIncluded(value.data.type, value.data.id, resourceOpts.relationships[relationshipKey], included)
            : value.data.id;
        }
      });
    }

    if (resourceOpts.unconvertCase) {
      deserializedData = this._convertCase(deserializedData, resourceOpts.unconvertCase);
    }

    if (data.links) {
      deserializedData.links = data.links;
    }

    if (data.meta) {
      deserializedData.meta = data.meta;
    }

    return deserializedData;
  }

  deserializeIncluded(type, id, relationshipOpts, included) {
    const includedResource = _.find(included, {
      type,
      id,
    });

    if (!includedResource) {
      return id;
    }

    return this.deserializeResource(type, includedResource, relationshipOpts.schema, included);
  }

  /**
   * Serialize resource objects.
   *
   * @see {@link http://jsonapi.org/format/#document-resource-objects}
   * @method JSONAPISerializer#serializeData
   * @private
   * @param {string} type resource's type.
   * @param {Object|Object[]} data input data.
   * @param {options} options resource's configuration options.
   * @param {Object[]} included.
   * @param {Object} extraData additional data.
   * @return {Object|Object[]} serialized data.
   */
  serializeData(type, data, options, included, extraData) {
    // Empty data
    if (_.isEmpty(data)) {
      // Return [] or null
      return Array.isArray(data) ? data : null;
    }

    // Array data
    if (Array.isArray(data)) {
      return data.map(d => this.serializeData(type, d, options, included, extraData));
    }

    // Single data
    return {
      type,
      id: data[options.id] ? data[options.id].toString() : undefined,
      attributes: this.serializeAttributes(data, options),
      relationships: this.serializeRelationships(data, options, included, extraData),
      links: this.processOptionsValues(data, extraData, options.links),
    };
  }

  /**
   * Serialize mixed resource object with a dynamic type resolved from data
   *
   * @see {@link http://jsonapi.org/format/#document-resource-objects}
   * @method JSONAPISerializer#serializeMixedData
   * @private
   * @param {Object} typeOption a dynamic type options.
   * @param {Object|Object[]} data input data.
   * @param {Object[]} included.
   * @param {Object} extraData additional data.
   * @return {Object|Object[]} serialized data.
   */
  serializeMixedData(typeOption, data, included, extraData) {
    // Empty data
    if (_.isEmpty(data)) {
      // Return [] or null
      return Array.isArray(data) ? data : null;
    }

    // Array data
    if (Array.isArray(data)) {
      return data.map(d => this.serializeMixedData(typeOption, d, included, extraData));
    }

    // Single data
    // Resolve type from data (can be a string or a function deriving a type-string from each data-item)
    const type = (typeof typeOption.type === 'function')
      ? typeOption.type(data)
      : _.get(data, typeOption.type);

    if (!type) {
      throw new Error(`No type can be resolved from data: ${JSON.stringify(data)}`);
    }

    if (!this.schemas[type]) {
      throw new Error(`No type registered for ${type}`);
    }

    return this.serializeData(type, data, this.schemas[type].default, included, extraData);
  }

  /**
   * Serialize top level 'included' key: an array of resource objects that are related to the resource data.
   * Remove all duplicated resource.
   *
   * @method JSONAPISerializer#serializeIncluded
   * @private
   * @param {Object[]} included.
   * @return {Object[]} included.
   */
  serializeIncluded(included) {
    const serializedIncluded = _.uniqWith(included, _.isEqual);
    return Object.keys(serializedIncluded).length > 0 ? serializedIncluded : undefined;
  }

  /**
   * Serialize 'attributes' key of resource objects: an attributes object representing some of the resource's data.
   *
   * @see {@link http://jsonapi.org/format/#document-resource-object-attributes}
   * @method JSONAPISerializer#serializeAttributes
   * @private
   * @param {Object|Object[]} data input data.
   * @param {Object} options resource's configuration options.
   * @return {Object} serialized attributes.
   */
  serializeAttributes(data, options) {
    if (options.whitelist.length > 0) {
      data = _.pick(data, options.whitelist);
    }

    // Support alternativeKey options for relationships
    const alternativeKeys = [];
    Object.keys(options.relationships).forEach((key) => {
      const rOptions = options.relationships[key];
      if (rOptions.alternativeKey) {
        alternativeKeys.push(rOptions.alternativeKey);
      }
    });

    // Remove unwanted keys (id, blacklist, relationships, alternativeKeys)
    let serializedAttributes = _.pick(data, _.difference(Object.keys(data), [options.id].concat(Object.keys(options.relationships), alternativeKeys, options.blacklist)));

    if (options.convertCase) {
      serializedAttributes = this._convertCase(serializedAttributes, options.convertCase);
    }

    return serializedAttributes;
  }

  /**
   * Serialize 'relationships' key of resource objects: a relationships object describing relationships between the resource and other JSON API resources.
   *
   * @see {@link http://jsonapi.org/format/#document-resource-object-relationships}
   * @method JSONAPISerializer#serializeRelationships
   * @private
   * @param {Object|Object[]} data input data.
   * @param {Object} options resource's configuration options.
   * @param {Object[]} included.
   * @param {Object} extraData additional data.
   * @return {Object} serialized relationships.
   */
  serializeRelationships(data, options, included, extraData) {
    const serializedRelationships = {};

    Object.keys(options.relationships).forEach((relationship) => {
      const rOptions = options.relationships[relationship];
      const schema = rOptions.schema || 'default';

      // Support alternativeKey options for relationships
      let relationshipKey = relationship;
      if (!data[relationship] && rOptions.alternativeKey) {
        relationshipKey = rOptions.alternativeKey;
      }

      if (!this.schemas[rOptions.type]) {
        throw new Error(`No type registered for "${rOptions.type}" on "${relationship}" relationship`);
      }

      if (!this.schemas[rOptions.type][schema]) {
        throw new Error(`No schema "${rOptions.schema}" registered for type "${rOptions.type}" on "${relationship}" relationship`);
      }

      const serializeRelationship = {
        links: this.processOptionsValues(data, extraData, rOptions.links),
        meta: this.processOptionsValues(data, extraData, rOptions.meta),
        data: this.serializeRelationship(rOptions.type, data[relationshipKey], this.schemas[rOptions.type][schema], included, extraData),
      };

      relationship = (options.convertCase) ? this._convertCase(relationship, options.convertCase) : relationship;

      _.set(serializedRelationships, relationship, serializeRelationship);
    });

    return Object.keys(serializedRelationships).length > 0 ? serializedRelationships : undefined;
  }

  /**
   * Serialize 'data' key of relationship's resource objects.
   *
   * @see {@link http://jsonapi.org/format/#document-resource-object-linkage}
   * @method JSONAPISerializer#serializeRelationship
   * @private
   * @param {string} rType the relationship's type.
   * @param {Object|Object[]} rData relationship's data.
   * @param {Object} rOptions relationship's configuration options.
   * @param {Object[]} included.
   * @param {Object} extraData additional data.
   * @return {Object|Object[]} serialized relationship data.
   */
  serializeRelationship(rType, rData, rOptions, included, extraData) {
    // No relationship data
    if (rData === undefined) {
      return null;
    }

    // Empty relationship data
    if (!(typeof rData === 'number') && _.isEmpty(rData)) {
      // Return [] or null
      return Array.isArray(rData) ? rData : null;
    }

    // To-many relationships
    if (Array.isArray(rData)) {
      return rData.map(d => this.serializeRelationship(rType, d, rOptions, included, extraData));
    }

    // To-one relationship
    const serializedRelationship = {
      type: rType,
    };

    // Support for unpopulated relationships (an id, or array of ids)
    if (!_.isObjectLike(rData)) {
      serializedRelationship.id = rData.toString();
    } else if (rData._bsontype && rData._bsontype === 'ObjectID') {
      // Support for unpopulated relationships (with mongoDB BSON ObjectId)
      serializedRelationship.id = rData.toString();
    } else {
        // Relationship has been populated
      serializedRelationship.id = rData[rOptions.id].toString();
      included.push(this.serializeData(rType, rData, rOptions, included, extraData));
    }
    return serializedRelationship;
  }

  /**
   * Process options values.
   * Allows options to be an object or a function with 1 or 2 arguments
   *
   * @method JSONAPISerializer#processOptionsValues
   * @private
   * @param {Object} data data passed to functions options
   * @param {Object} extraData additional data passed to functions options
   * @param {Object} options configuration options.
   * @param {string} fallbackModeIfOneArg fallback mode if only one argument is passed to function.
   * Avoid breaking changes with issue https://github.com/danivek/json-api-serializer/issues/27.
   * @return {Object}
   */
  processOptionsValues(data, extraData, options, fallbackModeIfOneArg) {
    let processedOptions = {};
    if (options && typeof options === 'function') {
      // Backward compatible with functions with one 'extraData' argument
      processedOptions = (fallbackModeIfOneArg === 'extraData' && options.length === 1) ? options(extraData) : options(data, extraData);
    } else {
      Object.keys(options).forEach((key) => {
        let processedValue = {};
        if (options[key] && typeof options[key] === 'function') {
          // Backward compatible with functions with one 'extraData' argument
          processedValue = (fallbackModeIfOneArg === 'extraData' && options[key].length === 1) ? options[key](extraData) : options[key](data, extraData);
        } else {
          processedValue = options[key];
        }
        Object.assign(processedOptions, { [key]: processedValue });
      });
    }

    // Clean all undefined values
    processedOptions = _.omitBy(processedOptions, _.isUndefined);

    return Object.keys(processedOptions).length > 0 ? processedOptions : undefined;
  }

  /**
   * Recursively convert object keys case
   *
   * @method JSONAPISerializer#_convertCase
   * @private
   * @param {Object|Object[]|string} data to convert
   * @param {string} convertCaseOptions can be snake_case', 'kebab-case' or 'camelCase' format.
   * @return {Object}
   */
  _convertCase(data, convertCaseOptions) {
    let converted;
    if (Array.isArray(data) || _.isPlainObject(data)) {
      converted = _.transform(data, (result, value, key) => {
        if (Array.isArray(value) || _.isPlainObject(value)) {
          result[this._convertCase(key, convertCaseOptions)] = this._convertCase(value, convertCaseOptions);
        } else {
          result[this._convertCase(key, convertCaseOptions)] = value;
        }
      });
    } else {
      switch (convertCaseOptions) {
        case 'snake_case':
          converted = _.snakeCase(data);
          break;
        case 'kebab-case':
          converted = _.kebabCase(data);
          break;
        case 'camelCase':
          converted = _.camelCase(data);
          break;
        default: // Do nothing
      }
    }

    return converted;
  }
};
