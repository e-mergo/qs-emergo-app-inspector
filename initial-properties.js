/**
 * E-mergo App Inspector Initial Properties
 *
 * @package E-mergo Tools Bundle
 *
 * @param  {String} qext          Extension QEXT data
 * @return {Object}               Initial properties
 */
define([
	"text!./qs-emergo-app-inspector.qext"
], function( qext ) {
	return {
		showTitles: false,
		title: JSON.parse(qext).title
	};
});
