/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module image/image/converters
 */

import ModelPosition from '@ckeditor/ckeditor5-engine/src/model/position';
import ModelDocumentFragment from '@ckeditor/ckeditor5-engine/src/model/documentfragment';
import modelWriter from '@ckeditor/ckeditor5-engine/src/model/writer';

/**
 * Returns function that converts image view representation:
 *
 *		<figure class="image"><img src="..." alt="..."></img></figure>
 *
 * to model representation:
 *
 *		<image src="..." alt="..."></image>
 *
 * The entire contents of `<figure>` except the first `<img>` is being converted as children
 * of the `<image>` model element.
 *
 * @returns {Function}
 */
export function viewFigureToModel() {
	return ( evt, data, consumable, conversionApi ) => {
		// Do not convert if this is not an "image figure".
		if ( !consumable.test( data.input, { name: true, class: 'image' } ) ) {
			return;
		}

		// Do not convert if image cannot be placed in model at this context.
		if ( !conversionApi.schema.check( { name: 'image', inside: data.context, attributes: 'src' } ) ) {
			return;
		}

		// Find an image element inside the figure element.
		const viewImage = Array.from( data.input.getChildren() ).find( viewChild => viewChild.is( 'img' ) );

		// Do not convert if image element is absent, is missing src attribute or was already converted.
		if ( !viewImage || !viewImage.hasAttribute( 'src' ) || !consumable.test( viewImage, { name: true } ) ) {
			return;
		}

		// Convert view image to model image.
		const modelImage = conversionApi.convertItem( viewImage, consumable, data );

		// Convert rest of figure element's children, but in the context of model image, because those converted
		// children will be added as model image children.
		data.context.push( modelImage );

		const modelChildren = conversionApi.convertChildren( data.input, consumable, data );

		data.context.pop();

		// Add converted children to model image.
		modelWriter.insert( ModelPosition.createAt( modelImage ), modelChildren );

		// Set model image as conversion result.
		data.output = modelImage;
	};
}

/**
 * Creates image attribute converter for provided model conversion dispatchers.
 *
 * @param {Array.<module:engine/conversion/modelconversiondispatcher~ModelConversionDispatcher>} dispatchers
 * @param {String} attributeName
 */
export function createImageAttributeConverter( dispatchers, attributeName ) {
	for ( let dispatcher of dispatchers ) {
		dispatcher.on( `addAttribute:${ attributeName }:image`, modelToViewAttributeConverter );
		dispatcher.on( `changeAttribute:${ attributeName }:image`, modelToViewAttributeConverter );
		dispatcher.on( `removeAttribute:${ attributeName }:image`, modelToViewAttributeConverter );
	}
}

// Model to view image converter converting given attribute, and adding it to `img` element nested inside `figure` element.
//
// @private
function modelToViewAttributeConverter( evt, data, consumable, conversionApi ) {
	const parts = evt.name.split( ':' );
	const consumableType = parts[ 0 ] + ':' + parts[ 1 ];

	if ( !consumable.consume( data.item, consumableType ) ) {
		return;
	}

	const figure = conversionApi.mapper.toViewElement( data.item );
	const img = figure.getChild( 0 );

	if ( parts[ 0 ] == 'removeAttribute' ) {
		img.removeAttribute( data.attributeKey );
	} else {
		img.setAttribute( data.attributeKey, data.attributeNewValue );
	}
}

// Holds all images that were converted for autohoisting.
const autohoistedImages = new WeakSet();

/**
 * If an `<img>` view element has not been converted, this converter checks if that element could be converted in any
 * context "above". If it could, the converter converts the `<img>` element even though it is not allowed in current
 * context and marks it to be autohoisted. Then {@link module:image/image/converters~hoistImage another converter}
 * moves the converted element to the correct location.
 *
 * @param {module:engine/model/document~Document} doc Model document in which conversion takes place.
 * @returns {Function}
 */
export function convertHoistableImage( doc ) {
	return ( evt, data, consumable, conversionApi ) => {
		const img = data.input;

		// If the image has not been consumed (converted)...
		if ( !consumable.test( img, { name: true, attribute: [ 'src' ] } ) ) {
			return;
		}
		// At this point the image has not been converted because it was not allowed by schema. It might be in wrong
		// context or missing an attribute, but above we already checked whether the image has mandatory src attribute.

		// If the image would be allowed if it was in one of its ancestors...
		const allowedContext = _findAllowedContext( { name: 'image', attributes: [ 'src' ] }, data.context, doc.schema );

		if ( !allowedContext ) {
			return;
		}

		// Convert it in that context...
		const newData = Object.assign( {}, data );
		newData.context = allowedContext;

		data.output = conversionApi.convertItem( img, consumable, newData );

		// And mark that image to be hoisted.
		autohoistedImages.add( data.output );
	};
}

// Basing on passed `context`, searches for "closest" context in which model element represented by `modelData`
// would be allowed by `schema`.
//
// @private
// @param {Object} modelData Object describing model element to check. Has two properties: `name` with model element name
// and `attributes` with keys of attributes of that model element.
// @param {Array} context Context in which original conversion was supposed to take place.
// @param {module:engine/model/schema~Schema} schema Schema to check with.
// @returns {Array|null} Context in which described model element would be allowed by `schema` or `null` if such context
// could not been found.
function _findAllowedContext( modelData, context, schema ) {
	// Copy context array so we won't modify original array.
	context = context.slice();

	// Prepare schema query to check with schema.
	// Since `inside` property is passed as reference to `context` variable, we don't need to modify `schemaQuery`.
	const schemaQuery = {
		name: modelData.name,
		attributes: modelData.attributes,
		inside: context
	};

	// Try out all possible contexts.
	while ( context.length && !schema.check( schemaQuery ) ) {
		const parent = context.pop();
		const parentName = typeof parent === 'string' ? parent : parent.name;

		// Do not try to autohoist "above" limiting element.
		if ( schema.limits.has( parentName ) ) {
			return null;
		}
	}

	// If `context` has any items it means that image is allowed in that context. Return that context.
	// If `context` has no items it means that image was not allowed in any of possible contexts. Return `null`.
	return context.length ? context : null;
}

/**
 * Looks through all children of converted {@link module:engine/view/element~Element view element} if it
 * has been converted to {@link module:engine/model/element~Element model element}. Breaks converted
 * element if `image` to-be-hoisted is found.
 *
 * **Note:** This converter should be fired only after the view element has been already converted, meaning that
 * `data.output` for that view element should be already generated when this converter is fired.
 *
 * @returns {Function}
 */
export function hoistImage() {
	return ( evt, data ) => {
		// If this element has been properly converted...
		if ( !data.output ) {
			return;
		}

		// And it is an element...
		// (If it is document fragment autohoisting does not have to break anything anyway.)
		// (And if it is text there are no children here.)
		if ( !data.output.is( 'element' ) ) {
			return;
		}

		// This will hold newly generated output. At the beginning it is only the original element.
		let newOutput = [];
		// Flag describing whether original element had any non-autohoisted children. If not, it will not be
		// included in `newOutput` and this will have to be fixed.
		let hasNonAutohoistedChildren = false;

		// Check if any of its children is to be hoisted...
		// Start from the last child - it is easier to break that way.
		for ( let i = data.output.childCount - 1; i >= 0; i-- ) {
			const child = data.output.getChild( i ) ;

			if ( autohoistedImages.has( child ) ) {
				// Break autohoisted element's parent:
				// <parent>{ left-children... }<authoistedElement />{ right-children... }</parent>   --->
				// <parent>{ left-children... }</parent><autohoistedElement /><parent>{ right-children... }</parent>
				//
				// or
				//
				// <parent>{ left-children... }<autohoistedElement /></parent> --->
				// <parent>{ left-children... }</parent><autohoistedElement />
				//
				// or
				//
				// <parent><autohoistedElement />{ right-children... }</parent> --->
				// <autohoistedElement /><parent>{ right-children... }</parent>
				//
				// or
				//
				// <parent><autohoistedElement /></parent> ---> <autohoistedElement />

				// Check how many children has to be in broken part of parent.
				const brokenChildrenCount = data.output.childCount - i - 1;
				let brokenParent = null;

				// If there are any children to be broken, created broken parent part and move appropriate children to it.
				if ( brokenChildrenCount > 0 ) {
					brokenParent = data.output.clone( false );
					brokenParent.appendChildren( data.output.removeChildren( i + 1, brokenChildrenCount ) );
				}

				// Remove autohoisted element from its parent.
				child.remove();

				// Break "leading" `data.output` in `newOutput` into one or more pieces:
				// Remove "leading" `data.output` (note that `data.output` is always first item in `newOutput`).
				newOutput.shift();

				// Add "broken parent" at the beginning, if it was created.
				if ( brokenParent ) {
					newOutput.unshift( brokenParent );
				}

				// Add autohoisted element at the beginning.
				newOutput.unshift( child );

				// Add `data.output` at the beginning, if there is anything left in it.
				if ( data.output.childCount > 0 ) {
					newOutput.unshift( data.output );
				}
			} else {
				hasNonAutohoistedChildren = true;
			}
		}

		// If output has changed...
		if ( newOutput.length ) {
			if ( !hasNonAutohoistedChildren ) {
				// Fix scenario where original element has been completely removed from results:
				// input:				<parent><autohoistedElement /><autohoistedElement /></parent>
				// after autohoisting:	<autohoistedElement /><autohoistedElement />
				// after this fix:		<autohoistedElement /><autohoistedElement /><parent></parent>
				newOutput.push( data.output );
			}

			// Normalize new output and set is as result output.
			data.output = new ModelDocumentFragment( newOutput );
		}
	};
}
