/**
 * E-mergo utility functions for getting app info
 *
 * @version 20230308
 * @author Laurens Offereins <https://github.com/lmoffereins>
 *
 * @param  {Object} qlik                Qlik's core API
 * @param  {Object} _                   Underscore
 * @param  {Object} $q                  Angular's Q promise library
 * @param  {Object} translator          Qlik's translator API
 * @return {Object}                     Importer API
 */
define([
	"qlik",
	"axios",
	"underscore",
	"ng!$q",
	"translator"
], function( qlik, axios, _, $q, translator ) {

	/**
	 * Holds the current app
	 *
	 * @type {Object}
	 */
	var currApp = qlik.currApp(),

	/**
	 * Holds the list of opened apps
	 *
	 * @type {Object}
	 */
	apps = {},

	/**
	 * Return the opened app
	 *
	 * Use this to make sure always only one connection per app is created.
	 *
	 * @param  {String} appId App identifier
	 * @return {Promise}      App object or rejected when not found
	 */
	openApp = function( appId ) {

		// Bail when no data was provided
		if (! appId) {
			return $q.reject("App with id '".concat(appId, "' not found"));
		}

		// Return when appId already is an app
		if (appId.id) {
			return $q.resolve(appId);
		}

		// Set current app
		if (! apps.hasOwnProperty(currApp.id)) {
			apps[currApp.id] = $q.resolve(currApp);
		}

		// Load the requested app
		if (! apps.hasOwnProperty(appId)) {
			var app = qlik.openApp(appId, { openWithoutData: true });

			apps[appId] = app.model.waitForOpen.promise.then( function() {
				var dfd = $q.defer();

				// No way was found to listen for the event that the app's layout is
				// loaded, so a delay is applied to ensure the API request must have
				// returned any value.
				setTimeout(function() { dfd.resolve(app); }, 120);

				return dfd.promise;
			});
		}

		return apps[appId];
	},

	/**
	 * Holds whether the installation is Qlik Sense Desktop
	 *
	 * @type {Boolean}
	 */
	isDesktop = false,

	/**
	 * Wrapper for requests made to Qlik's REST API's
	 *
	 * @param  {Object|String} args Request data or url
	 * @return {Promise} Request response
	 */
	request = function( args ) {
		var globalProps = currApp.global.session.options;

		// When provided just the url
		if ("string" === typeof args) {
			args = { url: args };
		}

		// Prefix QRS calls with the proxy
		if ((args.applyPrefix || 0 === args.url.indexOf("/qrs")) && globalProps.prefix.length) {
			args.url = globalProps.prefix.replace(/\/+$/, "").concat(args.url);
		}

		// Default params
		args.params = args.params || {};
		args.headers = args.headers || {};

		/**
		 * Axios is setup by QS to handle xsrf tokens.
		 */
		return axios(args);
	},

	/**
	 * Holds the list of extensions
	 *
	 * @type {Object}
	 */
	extensionList = null,

	/**
	 * Load QEXT files for extensions
	 *
	 * Will only load the file once per extension. Stores data in the `extensionList` variable.
	 *
	 * @param  {Array} extensionIds List of extension ids
	 * @return {Promise} Files are loaded
	 */
	loadExtensionQext = function( extensionIds ) {

		// Force array input
		if (! Array.isArray(extensionIds)) {
			extensionIds = [extensionIds];
		}

		return $q.all(_.uniq(extensionIds).filter( function( a ) {

			// Load files for existing extensions, only once
			return extensionList[a] && ! extensionList[a].type;
		}).map( function( a ) {

			// Get the path to the QEXT file
			var qext = extensionList[a].references.find( function( b ) {
				return ".qext" === b.logicalPath.substr(b.logicalPath.length - 5);
			});

			// Setup file request
			return request({url: qext.logicalPath, applyPrefix: true, extensionId: a });
		})).then( function( args ) {

			// Store file data in `extensionList`
			args.forEach( function( a ) {
				extensionList[a.config.extensionId] = _.defaults(a.data, extensionList[a.config.extensionId]);
			});
		});
	},

	/**
	 * Load info for extensions
	 *
	 * For installations with the QRS API: instead of loading all individual QEXT files
	 * of all extensions, please provide in `options.extensionIds` a list of relevant
	 * extensions, so the amount of requests can be limited.
	 *
	 * @param  {Object} options Optional. Options for getting extensions
	 * @return {Promise} Extension list
	 */
	getExtensions = function( options ) {
		var dfd = $q.defer();

		options = options || {};

		// Initial load of the list
		if (null === extensionList) {

			// Setup list as extensionId => data
			extensionList = {};

			// QS Desktop has no Repository, so use the deprecated (!) function
			if (isDesktop) {
				qlik.getExtensionList( function( list ) {
					list.forEach( function( a ) {
						extensionList[a.id] = a.data;
					});

					dfd.resolve(extensionList);
				});

			// Call the QRS REST API
			// Note that the initial extension request does not contain all necessary data, like
			// extension name, author, version, etc. These details need to be fetched directly
			// from the QEXT file of each extension separately.
			} else {
				request({
					url: "/qrs/extension/full"
				}).then( function( resp ) {
					resp.data.forEach( function( a ) {

						// In QRS `id` is the repository id, `name` is the extension id. Rename the
						// keys to align them with results for QS Desktop. Also `name` from the QEXT
						// is the human readable label.
						a.uuid = a.id;
						a.id = a.name;
						extensionList[a.id] = a;
					});

					// Load QEXT of each extension
					if (options.extensionIds) {
						loadExtensionQext(options.extensionIds).then( function() {
							dfd.resolve(extensionList);
						});
					} else {
						dfd.resolve(extensionList);
					}
				});
			}

		// Handle requests for additional extensions
		} else if (! isDesktop && options.extensionIds) {
			loadExtensionQext(options.extensionIds).then( function() {
				dfd.resolve(extensionList);
			});
		} else {
			dfd.resolve(extensionList);
		}

		return dfd.promise;
	},

	/**
	 * Load info for script
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getScript = async function( appId, options ) {
		var app = await openApp(appId);

		options = options || {};

		return app.getScript().then( function( data ) {
			return data.qScript.split("///$tab ").filter(Boolean).map( function( a, ix, all ) {
				return {
					id: "Section ".concat(ix + 1),
					label: a.split("\r\n")[0],
					index: ix,
					/*
					 * Drop first line which holds the section title.
					 */
					script: a.split("\r\n").slice(1).join("\r\n")
				};
			});
		});
	},

	/**
	 * Contains labels for sheet grid sizes
	 *
	 * @type {Object}
	 */
	sheetGridSizes = {
		small:  translator.get("properties.gridSmall"),
		medium: translator.get("properties.gridMedium"),
		large:  translator.get("properties.gridLarge")
	},

	/**
	 * Load info for sheets
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getSheets = async function( appId, options ) {
		var app = await openApp(appId);

		// Define default options
		options = _.defaults(options || {}, {
			loadWithObjects: false,
			includeSummary: false,
			validate: false
		});

		return app.getList("sheet").then( function( sessionObject ) {

			// Remove updates for this session object before going forward
			return sessionObject.close().then( function() {
				var loaders = {}, sheets = {}, sheetObjects = {}, extensionIds = [];

				// Get details of each sheet's objects
				sessionObject.layout.qAppObjectList.qItems.forEach( function( a ) {

					// Get sheet layout and properties
					sheets[a.qInfo.qId] = app.getObject(a.qInfo.qId);

					// Get sheet objects details
					if (options.loadWithObjects) {
						a.qData.cells.forEach( function( b ) {
							sheetObjects[b.name] = app.getObjectProperties(b.name).then( function( c ) {

								// Find the master object behind
								return (c.properties.qExtendsId && app.getObjectProperties(c.properties.qExtendsId).then( function( d ) {

									// Provide master object properties
									c.__masterobject = d.properties;

									return c;
								}) || $q.resolve(c)).then( function( d ) {

									// Fetch property tree to load list of children on the object.
									// This is mostly relevant for listboxes on a filterpane.
									if (d.properties.hasOwnProperty("qChildListDef")) {
										return app.getFullPropertyTree(d.id).then( function() {
											return d;
										});
									} else {
										return d;
									}
								}).then( function( d ) {
									var dfd = $q.defer();

									// Attach validation result to object
									if (options.validate) {
										validateVisualizationExpressions(app, d).then( function( validation ) {
											d.__validation = validation;
											dfd.resolve(d);
										});
									} else {
										d.__validation = getEmptyExpressionValidation();
										dfd.resolve(d);
									}

									return dfd.promise;
								});
							});

							// Load extension metadata
							extensionIds.push(b.type);
						});
					}
				});

				// Combine data to load
				loaders = _.extend({}, sheets, sheetObjects);

				// Load extension metadata
				loaders.extensionList = extensionIds.length ? getExtensions({ extensionIds: extensionIds }) : $q.resolve({});

				// Get all objects of all sheets
				return $q.all(loaders).then( function( args ) {

					// Walk sheets, sort by rank
					var sheetInfo = _.keys(sheets).map( function( sheetId ) {
						var object = args[sheetId], visualizations = [], visualizationList = null, details, qMeta = object.layout.qMeta, preview;

						// Collect sheet objects
						if (options.loadWithObjects) {
							visualizations = object.properties.cells.map( function( a ) {
								return {
									cell: a,
									errors: getErrorsFromExpressionValidation(args[a.name].__validation),
									children: args[a.name].hasOwnProperty("__propertyTree") ? args[a.name].__propertyTree.qChildren : [],
									properties: args[a.name].properties,
									masterobject: args[a.name].__masterobject
								};
							});

							// List unique objects on the sheet
							visualizationList = _.uniq(visualizations, false, function( a ) {
								return a.properties.qInfo.qType;
							}).map( function( a ) {

								// Get the visualization's name and count
								var name = args.extensionList.hasOwnProperty(a.properties.qInfo.qType) ? args.extensionList[a.properties.qInfo.qType].name : a.properties.qInfo.qType,
								    count = visualizations.filter( function( b ) { return a.properties.qInfo.qType === b.properties.qInfo.qType; }).length;

								return (count > 1 ? count.toString().concat(" x ") : "").concat(name);
							}).sort( function( a, b ) {
								return a.localeCompare(b);
							});
						}

						// Collect sheet details
						details = {
							description: {
								label: translator.get("Common.Description"),
								value: object.properties.qMetaDef.description
							},
							createdDate: {
								label: "Created", // Translation?
								value: qMeta.createdDate ? new Date(qMeta.createdDate).toLocaleString() : null // Not available on QS Desktop
							},
							status: {
								label: translator.get("geo.properties.wms.status"),
								value: qMeta.published
									? translator.get("AppOverview.Content.PublicSheets").concat(" (", new Date(qMeta.publishTime).toLocaleString(), ")")
									: (qMeta.approved ? translator.get("AppOverview.Content.CommunitySheets") : (!isDesktop ? "Personal" : null))
							},
							modifiedDate: {
								label: translator.get("QCS.Common.DataCatalog.Dataset.Property.LastModified"),
								value: qMeta.modifiedDate ? new Date(qMeta.modifiedDate).toLocaleString() : null // Not available on QS Desktop
							},
							owner: {
								label: translator.get("scripteditor.dataconnectors.owner"),
								value: "string" === typeof qMeta.owner ? qMeta.owner : (qMeta.owner ? "".concat(qMeta.owner.userDirectory, "/", qMeta.owner.userId) : null) // Not available on QS Desktop
							},
							visualizations: {
								label: translator.get("library.Visualizations"),
								value: visualizationList
							},
							gridSize: {
								label: translator.get("properties.gridSize"),
								value: sheetGridSizes[object.properties.gridResolution] || object.properties.gridResolution
							},
							layoutMode: {
								label: translator.get("properties.layoutMode"),
								value: object.properties.layoutOptions && "CUSTOM" === object.properties.layoutOptions.sheetMode ? translator.get("properties.custom") : null
							},
							customWidth: {
								label: translator.get("properties.customWidth"),
								value: object.properties.layoutOptions && "CUSTOM" === object.properties.layoutOptions.sheetMode ? object.properties.pxWidth : null
							},
							customHeight: {
								label: translator.get("properties.customHeight"),
								value: object.properties.layoutOptions && "CUSTOM" === object.properties.layoutOptions.sheetMode ? object.properties.pxHeight : null
							},
							cells: object.properties.height > 100 ? object.properties.height.concat(" (default is 100)") : null,
						};

						// Add object data to list
						return {
							id: sheetId,
							label: qMeta.title,
							details: details,
							visualizations: visualizations,
							rank: object.properties.rank,
							layout: object.layout,
							properties: object.properties
						};
					}).sort( function( a, b ) {
						return a.rank < b.rank ? -1 : 1; // No equals expected
					});

					// Define sheet summary
					if (options.includeSummary) {
						sheetInfo.unshift({
							id: translator.get("Common.Sheets"),
							label: "Summary",
							details: {
								approved: {
									label: translator.get("AppOverview.Content.PublicSheets"),
									value: sheetInfo.filter( function( a ) { return a.layout.qMeta.approved; }).length.toString()
								},
								published: {
									label: translator.get("AppOverview.Content.CommunitySheets"),
									value: sheetInfo.filter( function( a ) { return a.layout.qMeta.published && ! a.layout.qMeta.approved; }).length.toString()
								},
								personal: {
									label: "Personal", // Translation?
									value: sheetInfo.filter( function( a ) { return ! a.layout.qMeta.published; }).length.toString()
								}
							}
						});
					}

					return sheetInfo;
				});
			});
		});
	},

	/**
	 * Validate one or multiple expressions in the engine
	 *
	 * @param  {Object} app App object
	 * @param  {String|Array} expressions Expression or set of expressions
	 * @return {Promise} Validation result
	 */
	validateExpressions = function( app, expressions ) {
		if (! Array.isArray(expressions)) {
			expressions = [expressions];
		}

		// Checking expressions is app dependent!
		return $q.all(expressions.map( function( a ) {

			// First expand expression, than validate
			return app.model.enigmaModel.expandExpression(a).then( function( b ) {
				return app.model.enigmaModel.checkExpression(b).then( function( c ) {
					return {
						expression: a,
						expanded: b,
						validated: c
					};
				});
			});
		})).then( function( validation ) {
			return {
				hasError: !! validation.filter( function( a ) {
					return a.validated.qErrorMsg.length || a.validated.qBadFieldNames.length || a.validated.qDangerousFieldNames.length;
				}).length,
				errors: validation.map( function( a ) {

					// Indicate invalid field
					a.validated.isInvalid = !! a.validated.qErrorMsg.length || a.validated.qBadFieldNames.length || a.validated.qDangerousFieldNames.length;

					// Find bad field names
					if (a.validated.qBadFieldNames.length) {
						a.errorData = a.validated.qBadFieldNames.map( function( b ) {
							return a.expanded.substring(b.qFrom, b.qFrom + b.qCount);
						});
					}

					return a;
				})
			};
		});
	},

	/**
	 * Validate expressions on a visualization object
	 *
	 * @param  {Object} app App object
	 * @param  {Object} viz Visualization object
	 * @return {Promise} Validation result
	 */
	validateVisualizationExpressions = function( app, viz ) {
		var expressions = [];

		// Think of the children
		if (viz.hasOwnProperty("__propertyTree")) {
			expressions.push.apply(expressions,
				_.flatten(viz.__propertyTree.qChildren.map( function( a ) { return a.qProperty.qListObjectDef.qDef.qFieldDefs; }))
			);

		// Consider the hypercube
		} else if (viz.properties.hasOwnProperty("qHyperCubeDef")) {
			expressions.push.apply(expressions, [].concat(
				_.flatten(viz.properties.qHyperCubeDef.qDimensions.map( function( a ) { return a.qDef.qFieldDefs; })),
				_.flatten(viz.properties.qHyperCubeDef.qMeasures.map( function( a ) { return a.qDef.qDef; }))
			));

		// Unknown structure
		} else {
			return $q.resolve(getEmptyExpressionValidation());
		}

		return validateExpressions(app, expressions);
	},

	/**
	 * Return a empty expression validation object
	 *
	 * @return {Object} Validation object
	 */
	getEmptyExpressionValidation = function() {
		return {
			hasError: false,
			errors: []
		};
	},

	/**
	 * Return set of errors from expression validation object
	 *
	 * @param  {Object} validation Expression validation object
	 * @return {Array} Errors
	 */
	getErrorsFromExpressionValidation = function( validation ) {
		return validation.errors.map( function( a, ix ) {
			a.message = (a.validated.qErrorMsg || "Expression contains invalid field name");

			// Consider multiple expressions
			if (validation.errors.length > 1) {
				a.message = "Expression ".concat(ix + 1, ": ", a.message);
			}

			return a;
		}).filter( function( a ) {
			return a.validated.isInvalid;
		});
	},

	/**
	 * Load info for master dimensions
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getDimensions = async function( appId, options ) {
		var app = await openApp(appId), list = [];

		options = options || {};
		options.validate = options.validate || false;

		// Get shallow dimension list
		return app.model.enigmaModel.getDimensionList().then( function( items ) {

			// Walk list items
			return items.reduce( function( promise, a ) {

				// Get full dimension info
				return promise.then( function() {

					// Load dimension's layout and properties. Ignore using `app.getObjectProperties()` as
					// this does not return reliable results for master items in server environments.
					return app.model.engineApp.getDimension({ qId: a.qInfo.qId }).then( function( b ) {

						// Layout contains published metadata, properties contain defined settings.
						// These details will be loaded 'unto' the original object.
						return $q.all([ b.getLayout(), b.getProperties() ]).then( function() {
							var dfd = $q.defer();

							// Attach validation result to object
							if (options.validate) {
								validateExpressions(app, b.properties.qDim.qFieldDefs).then( function( validation ) {
									b.__validation = validation;
									dfd.resolve(b);
								});
							} else {
								b.__validation = getEmptyExpressionValidation();
								dfd.resolve(b);
							}

							return dfd.promise;
						});
					}).then( function( object ) {
						var isDrilldown = object.properties.qDim.qGrouping === "H", details, qMeta = object.layout.qMeta;

						// Collect dimension details
						details = {
							description: {
								label: translator.get("Common.Description"),
								value: qMeta.description
							},
							type: {
								label: translator.get("library.preview.header.type").replace(":", ""), // Remove trailing/leading colon
								value: translator.get(isDrilldown ? "library.preview.dimensiontype.drilldown" : "Common.Single")
							},
							label: {
								label: translator.get("Common.Label"),
								value: object.properties.qDim.qLabelExpression
							},
							definition: {
								label: translator.get("Common.Fields"),
								value: object.properties.qDim.qFieldDefs,
								isCode: true
							},
							createdDate: {
								label: "Created", // Translation?
								value: qMeta.createdDate ? new Date(qMeta.createdDate).toLocaleString() : null // Not available on QS Desktop
							},
							publishedDate: {
								label: translator.get("App.PublishedDate").replace(":", ""),
								value: qMeta.published ? new Date(qMeta.publishTime).toLocaleString() : translator.get("Common.No")
							},
							approved: {
								label: "Approved", // Translation?
								value: qMeta.approved ? translator.get("Common.Yes") : translator.get("Common.No")
							},
							modifiedDate: {
								label: "Modified", // Translation?
								value: qMeta.modifiedDate ? new Date(qMeta.modifiedDate).toLocaleString() : null // Not available on QS Desktop
							},
							owner: {
								label: "Owner", // translation?
								value: "string" === typeof qMeta.owner ? qMeta.owner : (qMeta.owner ? qMeta.owner.userDirectory.concat("/", qMeta.owner.userId) : null) // Not available on QS Desktop
							},
							tags: {
								label: translator.get("Common.Tags"),
								value: (qMeta.tags || [])
							}
						};

						// Add item to the list
						list.push({
							id: object.layout.qInfo.qId,
							label: qMeta.title,
							icon: object.__validation.hasError ? "debug" : (isDrilldown ? "drill-down" : false),
							details: details,
							layout: object.layout,
							properties: object.properties,
							errors: getErrorsFromExpressionValidation(object.__validation)
						});
					});
				});
			}, $q.resolve()).then( function() {

				// Return the full list sorted
				return list.sort( function( a, b ) {
					return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
				});
			});
		});
	},

	/**
	 * Load info for master measures
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getMeasures = async function( appId, options ) {
		var app = await openApp(appId), list = [];

		options = options || {};
		options.validate = options.validate || false;

		// Get shallow measure list
		return app.model.enigmaModel.getMeasureList().then( function( items ) {

			// Walk list items
			return items.reduce( function( promise, a ) {

				// Get full measure info
				return promise.then( function() {

					// Load measure's layout and properties. Ignore using `app.getObjectProperties()` as
					// this does not return reliable results for master items in server environments.
					return app.model.engineApp.getMeasure({ qId: a.qInfo.qId }).then( function( b ) {

						// Layout contains published metadata, properties contain defined settings
						return $q.all([ b.getLayout(), b.getProperties() ]).then( function() {
							var dfd = $q.defer();

							// Attach validation result to object
							if (options.validate) {
								validateExpressions(app, b.properties.qMeasure.qDef).then( function( validation ) {
									b.__validation = validation;
									dfd.resolve(b);
								});
							} else {
								b.__validation = getEmptyExpressionValidation();
								dfd.resolve(b);
							}

							return dfd.promise;
						});
					}).then( function( object ) {
						var details, qMeta = object.layout.qMeta;

						// Collect measure details
						details = {
							description: {
								label: translator.get("Common.Description"),
								value: qMeta.description
							},
							label: {
								label: translator.get("Common.Label"),
								value: object.properties.qMeasure.qLabelExpression
							},
							expression: {
								label: translator.get("Common.Expression"),
								value: object.properties.qMeasure.qDef,
								isCode: true
							},
							createdDate: {
								label: "Created", // Translation?
								value: qMeta.createdDate ? new Date(qMeta.createdDate).toLocaleString() : null // Not available on QS Desktop
							},
							publishedDate: {
								label: translator.get("App.PublishedDate").replace(":", ""),
								value: qMeta.published ? new Date(qMeta.publishTime).toLocaleString() : translator.get("Common.No")
							},
							approved: {
								label: "Approved", // Translation?
								value: qMeta.approved ? translator.get("Common.Yes") : translator.get("Common.No")
							},
							modifiedDate: {
								label: "Modified", // Translation?
								value: qMeta.modifiedDate ? new Date(qMeta.modifiedDate).toLocaleString() : null // Not available on QS Desktop
							},
							owner: {
								label: "Owner", // translation?
								value: "string" === typeof qMeta.owner ? qMeta.owner : (qMeta.owner ? "".concat(qMeta.owner.userDirectory, "/", qMeta.owner.userId) : null) // Not available on QS Desktop
							},
							tags: {
								label: translator.get("Common.Tags"),
								value: (qMeta.tags || [])
							}
						};

						// Add item to the list
						list.push({
							id: object.layout.qInfo.qId,
							label: qMeta.title,
							icon: object.__validation.hasError ? "debug" : "",
							details: details,
							layout: object.layout,
							properties: object.properties,
							errors: getErrorsFromExpressionValidation(object.__validation)
						});
					});
				});
			}, $q.resolve()).then( function() {

				// Return the full list sorted
				return list.sort( function( a, b ) {
					return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
				});
			});
		});
	},

	/**
	 * Load info for master objects (visualizations)
	 *
	 * TODO: find out invalid viz
	 * qlik.currApp().model.engineApp.getObject({qId:"FWwchY"}).then(function(a){a.Invalidated.bind(function(){console.log("Invalidated", arguments)});return a.getLayout().then(function(){return a.getProperties()}).then(function(){return a.getFullPropertyTree()}).then(function(){console.log(a)})}).catch(console.error)
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getMasterObjects = async function( appId, options ) {
		var app = await openApp(appId), list = [];

		options = options || {};
		options.validate = options.validate || false;

		// Get shallow master object list
		return app.model.enigmaModel.getMasterObjectList().then( function( items ) {

			// Walk list items
			return items.reduce( function( promise, a ) {

				// Get full object info
				return promise.then( function() {

					// Load object's layout and properties. Ignore using `app.getObjectProperties()` as
					// this does not return reliable results for master items in server environments.
					return app.model.engineApp.getObject({ qId: a.qInfo.qId }).then( function( b ) {

						// Layout contains published metadata, properties contain defined settings
						return $q.all([ b.getLayout(), b.getProperties() ]).then( function() {

							// Load metadata for the visualization
							return getExtensions([b.layout.visualization]);

						}).then( function() {

							// Fetch property tree to load list of children on the object.
							// This is mostly relevant for listboxes on a filterpane.
							if (b.properties.hasOwnProperty("qChildListDef")) {
								return app.getFullPropertyTree(b.id).then( function( c ) {
									b.__propertyTree = c.propertyTree;
									return b;
								});
							} else {
								return b;
							}
						});
					}).then( function( b ) {
						var dfd = $q.defer();

						// Attach validation result to object
						if (options.validate) {
							validateVisualizationExpressions(app, b).then( function( validation ) {
								b.__validation = validation;
								dfd.resolve(b);
							});
						} else {
							b.__validation = getEmptyExpressionValidation();
							dfd.resolve(b);
						}

						return dfd.promise;
					}).then( function( object ) {
						var qMeta = object.layout.qMeta,

						// Collect master object details
						details = {
							description: {
								label: translator.get("Common.Description"),
								value: qMeta.description
							},
							type: {
								label: "Type", // Translation?
								value: extensionList.hasOwnProperty(object.properties.visualization) ? extensionList[object.properties.visualization].name : object.properties.visualization
							},
							createdDate: {
								label: "Created", // Translation?
								value: qMeta.createdDate ? new Date(qMeta.createdDate).toLocaleString() : null // Not available on QS Desktop
							},
							publishedDate: {
								label: translator.get("App.PublishedDate").replace(":", ""),
								value: qMeta.published ? new Date(qMeta.publishTime).toLocaleString() : translator.get("Common.No")
							},
							approved: {
								label: "Approved", // Translation?
								value: qMeta.approved ? translator.get("Common.Yes") : translator.get("Common.No")
							},
							modifiedDate: {
								label: "Modified", // Translation?
								value: qMeta.modifiedDate ? new Date(qMeta.modifiedDate).toLocaleString() : null // Not available on QS Desktop
							},
							owner: {
								label: "Owner", // translation?
								value: "string" === typeof qMeta.owner ? qMeta.owner : (qMeta.owner ? "".concat(qMeta.owner.userDirectory, "/", qMeta.owner.userId) : null) // Not available on QS Desktop
							},
							tags: {
								label: translator.get("Common.Tags"),
								value: (qMeta.tags || [])
							}
						};

						// Add item to the list
						list.push({
							id: object.layout.qInfo.qId,
							label: object.layout.qMeta.title,
							icon: object.__validation.hasError ? "debug" : "",
							details: details,
							layout: object.layout,
							properties: object.__propertyTree && object.__propertyTree.qProperty || object.properties,
							children: object.__propertyTree && object.__propertyTree.qChildren,
							errors: getErrorsFromExpressionValidation(object.__validation)
						});
					});
				});
			}, $q.resolve()).then( function() {

				// Return the full list sorted
				return list.sort( function( a, b ) {
					return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
				});
			});
		});
	},

	/**
	 * Load info for alternate states
	 *
	 * Alternate states don't have any other data than their name.
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getAlternateStates = async function( appId, options ) {
		var app = await openApp(appId);

		return $q.resolve(
			app.model.layout.qStateNames.map( function( a ) {
				return {
					id: a,
					label: a
				};
			}).sort( function( a, b ) {
				return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
			})
		);
	},

	/**
	 * Load info for variables
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getVariables = async function( appId, options ) {
		var app = await openApp(appId), list = [];

		options = options || {};
		options.validate = !! options.validate || false;
		options.qIsReserved = "undefined" !== typeof options.qIsReserved ? options.qIsReserved : null; // `null` ignores reserved-state. True/False will filter for that value.

		// Get shallow variable list
		return app.model.enigmaModel.getVariableList().then( function( items ) {

			// Walk list items
			return items.reduce( function( promise, a ) {

				// Get full object info
				return promise.then( function() {

					// Load object's layout and properties. Ignore using `app.getObjectProperties()`
					// as this does not return reliable results for variables in server environments.
					return app.model.engineApp.getVariableById(a.qInfo.qId).then( function( b ) {

						// Layout contains published metadata, properties contain defined settings
						return $q.all([ b.getLayout(), b.getProperties() ]).then( function() {
							var dfd = $q.defer();

							// Attach validation result to object
							if (options.validate){
								validateExpressions(app, b.properties.qDefinition).then( function( validation ) {
									b.__validation = validation;
									dfd.resolve(b);
								});
							} else {
								b.__validation = getEmptyExpressionValidation();
								dfd.resolve(b);
							}

							return dfd.promise;
						});
					}).then( function( object ) {

						// Collect variable details
						var details = {
							description: {
								label: translator.get("Common.Description"),
								value: object.properties.qComment
							},
							definition: {
								label: translator.get("Variable.Definition"),
								value: object.properties.qDefinition,
								isCode: true
							},
							createdDate: {
								label: "Created", // Translation?
								value: object.layout.qMeta.createdDate ? new Date(object.layout.qMeta.createdDate).toLocaleString() : null // Not available on QS Desktop
							},
							modifiedDate: {
								label: "Modified", // Translation?
								value: object.layout.qMeta.modifiedDate ? new Date(object.layout.qMeta.modifiedDate).toLocaleString() : null // Not available on QS Desktop
							},
							tags: {
								label: translator.get("Common.Tags"),
								value: (a.qData.tags || []) // Tags are not available on either the layout or properties
							}
						};

						// Add item to the list
						list.push({
							id: object.layout.qInfo.qId,
							label: object.properties.qName,
							icon: object.__validation.hasError ? "debug" : (object.properties.qIsScriptCreated ? "script" : ""),
							details: details,
							layout: a, // Not the actual layout, but layout does not contain `qName` and `qIsReserved`
							properties: object.properties,
							errors: getErrorsFromExpressionValidation(object.__validation)
						});
					});
				});
			}, $q.resolve()).then( function() {

				// Filter for reserved variables
				return list.filter( function( a ) {
					return null === options.qIsReserved || options.qIsReserved === !! a.layout.qIsReserved;
				// Return the full list sorted
				}).sort( function( a, b ) {
					return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
				});
			});
		});
	},

	/**
	 * Load info for bookmarks
	 *
	 * @param {String} appId App identifier
	 * @param {Object} options Optional. Load options.
	 * @return {Promise} Loaded info
	 */
	getBookmarks = async function( appId, options ) {
		var app = await openApp(appId), list = [];

		options = options || {};
		options.validate = options.validate || false;

		// Get shallow bookmark list
		return $q.all({
			items: app.model.enigmaModel.getBookmarkList(),
			sheets: getSheets(appId, { loadWithObjects: false })
		}).then( function( args ) {

			// Walk list items
			return args.items.reduce( function( promise, a ) {

				// Get full object info
				return promise.then( function() {

					// Load object's layout and properties. Ignore using `app.getObjectProperties()` as
					// this does not return reliable results for bookmarks in server environments.
					return app.model.engineApp.getBookmark(a.qInfo.qId).then( function( b ) {

						// Layout contains published metadata, properties contain defined settings
						return $q.all([ b.getLayout(), b.getProperties() ]).then( function() {

							// Get set analysis definition of the bookmark
							var getSetAnalysis = {};

							// Walk each applied state
							a.qData.qBookmark.qStateData.forEach( function( qStateData ) {

								// Get the state's set analysis for the bookmark
								getSetAnalysis[qStateData.qStateName] = app.model.engineApp.getSetAnalysis(qStateData.qStateName, a.qInfo.qId);
							});

							return $q.all(getSetAnalysis).then( function( setAnalysis ) {
								return {
									object: b,
									setExpression: setAnalysis
								};
							});
						});
					}).then( function( bookmark ) {
						var setExpression = [], errors = [], i, details, qBookmark = bookmark.object.layout.qBookmark, qMeta = bookmark.object.layout.qMeta;

						// Get set analysis expressions of the bookmark
						for (i in bookmark.setExpression) {
							if (bookmark.setExpression.hasOwnProperty(i) && bookmark.setExpression[i].qSetExpression.length) {

								// Setup human readable format
								setExpression.push(("$" === i ? translator.get("AlternateState.DefaultState") : i).concat(": ", bookmark.setExpression[i].qSetExpression));
							}
						}

						// Collect bookmark details
						details = {
							description: {
								label: translator.get("Common.Description"),
								value: qMeta.description
							},
							setExpression: {
								label: translator.get("Bookmarks.SetExpression"),
								value: setExpression.sort( function( a, b ) {
									return a.localeCompare(b);
								})
							},
							fields: {
								label: translator.get("Common.Fields"),
								value: _.uniq(bookmark.object.layout.qFieldInfos.map( function( a ) {
									return a.qFieldName;
								}))
							},
							createdDate: {
								label: "Created", // Translation?
								value: qMeta.createdDate ? new Date(qMeta.createdDate).toLocaleString() : null // Not available on QS Desktop
							},
							publishedDate: {
								label: translator.get("App.PublishedDate").replace(":", ""),
								value: qMeta.published ? new Date(qMeta.publishTime).toLocaleString() : translator.get("Common.No")
							},
							approved: {
								label: "Approved", // Translation?
								value: qMeta.approved ? translator.get("Common.Yes") : translator.get("Common.No")
							},
							modifiedDate: {
								label: "Modified", // Translation?
								value: qMeta.modifiedDate ? new Date(qMeta.modifiedDate).toLocaleString() : null // Not available on QS Desktop
							},
							owner: {
								label: "Owner", // translation?
								value: "string" === typeof qMeta.owner ? qMeta.owner : (qMeta.owner ? "".concat(qMeta.owner.userDirectory, "/", qMeta.owner.userId) : null) // Not available on QS Desktop
							},
							sheet: {
								label: translator.get("Common.Sheet"),
								value: bookmark.object.properties.sheetId ? args.sheets.filter( function( b ) {
									return bookmark.object.properties.sheetId === b.id;
								}).map( function( b ) {
									return b.label;
								}) : null
							},
							hasPatches: {
								label: "Saved layout",
								value: qBookmark.qPatches.length ? translator.get("Common.Yes") : null
							}
						};

						// Collect errors from missing fields
						if (options.validate) {
							errors = _.flatten(qBookmark.qStateData.filter( function( a ) {
								return !! a.qFieldItems.filter( function( b ) {
									return "NOT_PRESENT" === b.qDef.qType;
								}).length;
							}).map( function( a ) {
								return a.qFieldItems.filter( function( b ) {
									return "NOT_PRESENT" === b.qDef.qType;
								}).map( function( b ) {
									var message = "Expression contains invalid field name `".concat(b.qDef.qName, "`");

									// Consider state when multiple states are active
									if (qBookmark.qStateData.length > 1) {
										message = message.concat(" in state ", "$" === a.qStateName ? translator.get("AlternateState.DefaultState") : a.qStateName);
									}
									
									return message;
								});
							}));
						}

						// Add object data to list
						list.push({
							id: bookmark.object.layout.qInfo.qId,
							label: qMeta.title,
							icon: errors.length ? "debug" : "",
							details: details,
							setExpression: bookmark.setExpression,
							layout: bookmark.object.layout,
							properties: bookmark.object.properties,
							errors: errors
						});
					});
				});
			}, $q.resolve()).then( function() {

				// Return the full list sorted
				return list.sort( function( a, b ) {
					return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
				});
			});
		});
	},

	/**
	 * Retreive details from an item's data definition
	 *
	 * @param  {Object} props Properties object containing qHyperCubeDef etc.
	 * @return {Object}       Hypercube details
	 */
	getDataDefinition = function( props ) {
		var hc = {};

		// Hypercube
		if (props.hasOwnProperty("qHyperCubeDef")) {

			// Dimensions
			hc.dimensions = {
				label: translator.get("Common.Dimensions"),
				value: props.qHyperCubeDef.qDimensions.map( function( a ) {
					return a.qLibraryId
						? a.qLibraryId.concat(" (", translator.get("properties.masterItem"), ")")
						: a.qDef.qFieldDefs.join(", ");
				}),
				isCode: true
			};

			// Measures
			hc.measures = {
				label: translator.get("Common.Measures"),
				value: props.qHyperCubeDef.qMeasures.map( function( a ) {
					return a.qLibraryId
						? a.qLibraryId.concat(" (", translator.get("properties.masterItem"), ")")
						: a.qDef.qDef;
				}),
				isCode: true
			};

		// List object
		} else if (props.hasOwnProperty("qListObjectDef")) {

			// Dimensions
			hc.fields = {
				label: translator.get("Common.Fields"),
				value: [props.qListObjectDef.qLibraryId
					? props.qListObjectDef.qLibraryId.concat(" (", translator.get("properties.masterItem"), ")")
					: props.qListObjectDef.qDef.qFieldDefs.join(", ")],
				isCode: true
			};
		}

		return hc;
	},

	/**
	 * Retreive data definition details from an item's list of children
	 *
	 * Applies `getDataDefinition` for a list of qChildren.
	 *
	 * @param  {Array} children Children properties
	 * @return {Array}          Children hypercube details
	 */
	getChildrenDataDefinition = function( children ) {
		return children.map( function( a ) {
			return getDataDefinition(a.qProperty);
		}).reduce( function( data, a ) {

			// Wrap definitions for children in a single list
			for (var i in a) {
				if (a.hasOwnProperty(i)) {
					if (data.hasOwnProperty(i)) {
						data[i].value = data[i].value.concat(a[i].value);
					} else {
						data[i] = a[i];
					}
				}
			}

			return data;
		}, {});
	};

	// Set `isDesktop` on start
	(function() {
		currApp.global.isPersonalMode().then( function( resp ) {
			isDesktop = resp.qReturn;
		});
	})();

	return {
		isDesktop: function() { return isDesktop; },
		extensions: getExtensions,
		script: getScript,
		sheets: getSheets,
		dimensions: getDimensions,
		measures: getMeasures,
		masterObjects: getMasterObjects,
		alternateStates: getAlternateStates,
		variables: getVariables,
		bookmarks: getBookmarks,
		getDataDefinition: getDataDefinition,
		getChildrenDataDefinition: getChildrenDataDefinition
	};
});
