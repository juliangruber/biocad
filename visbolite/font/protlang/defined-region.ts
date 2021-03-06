
import { Vec2, Rect, Matrix } from 'jfw/geom'
import { svg } from 'jfw/vdom'

function createGeometry(size) {

    var curveWidth = size.y / 2
    var bodyWidth = size.x - curveWidth * 2

    return {
        bodyTopLeft: Vec2.fromXY(curveWidth, 0),
        bodyTopRight: Vec2.fromXY(curveWidth + bodyWidth, 0),
        bodyBottomRight: Vec2.fromXY(curveWidth + bodyWidth, size.y),
        bodyBottomLeft: Vec2.fromXY(curveWidth, size.y),
        topRight: Vec2.fromXY(size.x, 0),
        topLeft: Vec2.fromXY(0, 0),
        bottomRight: Vec2.fromXY(size.x, size.y),
        bottomLeft: Vec2.fromXY(0, size.y),
        height: size.y,
        curveWidth: curveWidth
    }
}

function renderGlyph(renderOpts) {

    var geom = createGeometry(renderOpts.size)

    var path = [

        'M' + geom.bodyTopLeft.toPathString(),

        'L' + geom.bodyTopRight.toPathString(),

        'C' + geom.topRight.toPathString() + ' '
            + geom.bottomRight.toPathString() + ' '
            + geom.bodyBottomRight.toPathString() + ' ',

        'L' + geom.bodyBottomLeft.toPathString(),

        'C' + geom.bottomLeft.toPathString() + ' '
            + geom.topLeft.toPathString() + ' '
            + geom.bodyTopLeft.toPathString() + ' ',

    ].join('');

    return svg('path', {
        d: path,
        //stroke: renderOpts.border ? 'black' : 'none',
        //fill: fill
        fill: 'none',
        stroke: renderOpts.defaultColor || 'black'
    });

    /*
    return svg('g', [
        svg('line', {
            stroke: 'black',
            fill: 'none',
            'stroke-width': 3,
            x1: geom.topLeft.x,
            y1: geom.topLeft.y,
            x2: geom.bottomLeft.x,
            y2: geom.bottomLeft.y
        }),
        svg('line', {
            stroke: 'black',
            fill: 'none',
            'stroke-width': 3,
            x1: geom.topRight.x,
            y1: geom.topRight.y,
            x2: geom.bottomRight.x,
            y2: geom.bottomRight.y
        }),
    ])*/
}

export default {

    render: renderGlyph,
    backbonePlacement: 'mid',
    isContainer: true,
    scale: Vec2.fromXY(1.0, 1.0),
    interruptsBackbone: true,
    resizable: true,
    resizableVertically: false,
    splitsBackbone: true,
}



