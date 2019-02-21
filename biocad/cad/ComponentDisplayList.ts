

import { SXSequenceFeature, SXSubComponent, SXSequenceConstraint, SXComponent, SXIdentified, SXLocation, SXRange } from "sbolgraph"
import { LinearRange, LinearRangeSet } from 'jfw/geom'
import { Specifiers } from "bioterms";

let bpToGridScale = 0.02
let minGridWidth = 2

export interface BackboneGroup {
    backbones:Map<number,Backbone>
    backboneLength:number
}

export interface Backbone {
    children:BackboneChild[]
    rangesUsed:LinearRangeSet
}

export interface BackboneChild {
    object:SXIdentified
    range:LinearRange
}

export default class ComponentDisplayList {


    backboneGroups:Array<BackboneGroup>
    ungrouped:Array<SXIdentified>


    static fromComponent(SXComponent:SXComponent):ComponentDisplayList {

        return new ComponentDisplayList(SXComponent)

    }



    private constructor(cd:SXComponent) {
        

        const visited:Set<string> = new Set()


        /* first everything with locations goes in one set
         */
        const saSet:Set<string> = new Set()

        for(let sc of cd.subComponents) {
            //console.log(sc)

            if(sc.locations.length > 0) {

                saSet.add(sc.uri)
                visited.add(sc.uri)

            }
        }

        for(let sc of cd.sequenceFeatures) {

            //console.log(sc)

            if(sc.locations.length > 0) {

                saSet.add(sc.uri)
                visited.add(sc.uri)

            }

        }


        const sets:Set<Set<string>> = new Set()

        if(saSet.size > 0)
            sets.add(saSet)


        /* now we need to group together things linked by constraints
         */
        for(let sc of cd.sequenceConstraints) {

           let firstSet:Set<string>|null = null

           for(let set of sets) {

               if(set.has(sc.subject.uri) || set.has(sc.object.uri)) {

                   if(firstSet !== null) {

                      for(let elem of set)
                        firstSet.add(elem)
                    
                      set.clear()

                   } else {

                       set.add(sc.subject.uri)
                       set.add(sc.object.uri)
                       visited.add(sc.subject.uri)
                       visited.add(sc.object.uri)

                       firstSet = set
                   }
               } 
           }

           if(!firstSet) {

               let newSet:Set<string> = new Set()
               newSet.add(sc.subject.uri)
               newSet.add(sc.object.uri)
               visited.add(sc.subject.uri)
               visited.add(sc.object.uri)
               sets.add(newSet)

           }
               
        }


        this.backboneGroups = []

        for(let set of Array.from(new Set(sets.values()))) {

            if(set.size === 0)
                continue

            // the set contains a bunch of objects that are related by
            // sequenceannotations or constraints
            // each of these objects has zero or more locations.
            // in the case of multiple ranges, we want to create multiple depictions,
            // hence "expanding" each object into its locations
            // some objects may have no locations at all and are positioned only by
            // constraints.

            let backboneElements = expandLocations(Array.from(set).map((uri:string) => {

                console.log(uri, 'contained in backbone group')

                const facade:SXIdentified|undefined = cd.graph.uriToFacade(uri)

                if(!facade)
                    throw new Error('???')

                return facade

            }))

            let findElement = (uri:string):number => {

                for(let i = 0; i < backboneElements.length; ++ i) {
                    let element = backboneElements[i]

                    if(element instanceof SXLocation) {

                        let location:SXLocation = element as SXLocation
                        let containingObject:SXIdentified|undefined = location.containingObject

                        if(containingObject && containingObject.uri === uri) {
                            return i
                        }

                    } else {
                        if(element.uri === uri)
                            return i
                    }
                }

                return -1
            }

            let uriToPositionedChild:Map<string,BackboneChild> = new Map()

            // we need to create a backbone group for these objects.
            // it will contain one or more backbones depending on how many overlapping
            // features there are.

            let backboneLength = 0

            if(cd.sequence && cd.sequence.elements) {
                backboneLength = cd.sequence.elements.length * bpToGridScale
            }

            let group = {
                backbones: new Map<number, Backbone>(),
                backboneLength: backboneLength
            }

            let backboneForRange = (range:LinearRange):Backbone => {

                let n = 0

                for(;;) {

                    let backbone = group.backbones.get(n)

                    if(!backbone) {
                        backbone = {
                            children: [],
                            rangesUsed: new LinearRangeSet()
                        }
                        group.backbones.set(n, backbone)
                    }

                    if(!backbone.rangesUsed.intersectsRange(range.normalise())) {
                        return backbone
                    }

                    // move upwards for forward annotations, downwards for reverse
                    if(range.start < range.end)
                        -- n
                    else
                        ++ n
                }

            }

            let place = (object:SXIdentified, range:LinearRange) => {

                if(uriToPositionedChild.has(object.uri)) {
                    throw new Error('attempted to position object twice')
                }

                let backbone = backboneForRange(range)

                backbone.rangesUsed.push(range.normalise())

                let child = { object, range }

                backbone.children.push(child)
                uriToPositionedChild.set(object.uri, child)

            }

            // 1. position all fixed
            for(let element of backboneElements) {
                if(element instanceof SXRange && element.isFixed()) {
                    if(!element.start) {
                        throw new Error('???')
                    }
                    let start = element.start * bpToGridScale
                    let end = Math.max(element.end ? element.end * bpToGridScale : 0, start + minGridWidth)
                    if(element.orientation === Specifiers.SBOLX.Orientation.ReverseComplement) {
                        let tmp = end
                        end = start
                        start = tmp
                    }
                    let range = new LinearRange(start, end)
                    place(element, range)
                }
            }

            // 2. position all constrained that reference fixed
            /// ... and constrained that reference the former, recursively
            /// (keep going until we can't position anything else)
            //
            for(;;) {
                let doneSomething = false
                for(let constraint of cd.sequenceConstraints) {
                    let s = constraint.subject
                    let o = constraint.object
                    let r = constraint.restriction

                    let positionedS = uriToPositionedChild.get(s.uri)
                    let positionedO = uriToPositionedChild.get(o.uri)

                    if(positionedS) {
                        if(positionedO) {
                            continue
                        }

                        // s done, o not
                        let width = seqWidth(o)

                        if(r === Specifiers.SBOLX.SequenceConstraint.Precedes) {

                            let sRange = uriToPositionedChild.get(s.uri)

                            if(!sRange)
                                throw new Error('???')
                            
                            if(positionedS.range.start < positionedS.range.end) {
                                // forward; place o AFTER s because s precedes o
                                place(o, new LinearRange(positionedS.range.end, positionedS.range.end + width))
                            } else {
                                // reverse; place o AFTER s because s precedes o
                                place(o, new LinearRange(positionedS.range.end, positionedS.range.end - width))
                            }
                            doneSomething = true
                        }

                    } else if(positionedO) {
                        if(positionedS) {
                            continue
                        }
                        // o done, s not

                        let width = seqWidth(s)

                        if(r === Specifiers.SBOLX.SequenceConstraint.Precedes) {

                            let sRange = uriToPositionedChild.get(s.uri)

                            if(!sRange)
                                throw new Error('???')

                            if(positionedO.range.start < positionedO.range.end) {
                                // forward; place s BEFORE o because s precedes o
                                place(s, new LinearRange(positionedO.range.start - width, positionedO.range.start))
                            } else {
                                // reverse; place s BEFORE o because s precedes o
                                place(s, new LinearRange(positionedO.range.start + width, positionedO.range.start))
                            }

                            doneSomething = true
                        }

                        doneSomething = true
                    } else {
                        // neither done; leave for later
                        continue
                    }
                }
                if(!doneSomething)
                    break
            }

            // if there are any left they have no relation to the fixed
            // locations whatsoever, so need to be sorted purely using
            // constraints

            // prevent infinite loop on cyclic constraints
            let maxIters = 10

            // TODO: forward/reverse?
            for(let i = 0; i < maxIters; ++ i) {
                let doneSomething = false
                for(let constraint of cd.sequenceConstraints) {
                    let subjectIdx = findElement(constraint.subject.uri)
                    let objIdx = findElement(constraint.object.uri)
                    let restriction = constraint.restriction
                    if(subjectIdx === -1 || objIdx === -1) {
                        console.warn('constraint: missing s/o:', constraint.subject.uri, subjectIdx, constraint.object.uri, objIdx)
                        continue
                    }
                    if(restriction === Specifiers.SBOLX.SequenceConstraint.Precedes) {
                        move(backboneElements, subjectIdx, objIdx - 1)
                    }
                }
                if(!doneSomething)
                    break
            }

            let constraintElements =
                backboneElements.filter((element) => !uriToPositionedChild.has(element.uri))

            // they're now sorted and filtered out, but where does the first one go?
            // 0 I guess?
            let x = 0
            for(let element of constraintElements) {

                let width = seqWidth(element)
                
                if(element instanceof SXSubComponent) {
                    if(element.instanceOf.sequence && element.instanceOf.sequence.elements) {
                        width = element.instanceOf.sequence.elements.length * bpToGridScale
                    }
                }

                width = Math.max(width, minGridWidth)

                // TODO: orientation - would come from the location
                place(element, new LinearRange(x, x + width))

                x = x + width
            }

            for(let backbone of group.backbones.values()) {
                backbone.rangesUsed.forEach((range) => {
                    let rangeAsForward = range.normalise()
                    group.backboneLength = Math.max(group.backboneLength, rangeAsForward.end)
                })
            }

            group.backboneLength = Math.max(group.backboneLength)

            this.backboneGroups.push(group)

        }
        

        function seqWidth(element:SXIdentified) {
            let width = 0
            if(element instanceof SXSubComponent) {
                if (element.instanceOf.sequence && element.instanceOf.sequence.elements) {
                    width = element.instanceOf.sequence.elements.length * bpToGridScale
                }
            }
            width = Math.max(width, minGridWidth)
            return width
        }


        this.ungrouped = cd.subComponents.filter((c:SXSubComponent) => {
            return !visited.has(c.uri)
        })

        console.dir(this.backboneGroups)


        //console.log('ComponentDisplayList', cd.displayName, this.backboneGroups.length + ' backbone group(s)')
        //console.log('ComponentDisplayList',  cd.displayName,this.ungrouped.length + ' ungrouped')



        // might not have any locations cos it's positioned only by a sequenceconstraint


        function expandLocations(children:Array<SXIdentified>):Array<SXLocation|SXSequenceFeature|SXSubComponent> {

            const res:Array<SXLocation> = []

            for(let child of children) {

                Array.prototype.push.apply(res, expandChildLocations(child))
                //Array.prototype.push.apply(res, [ child ])

            }

            return res
        }

        function expandChildLocations(child:SXIdentified):Array<SXLocation|SXSequenceFeature|SXSubComponent> {

            var locations

            if(child instanceof SXSequenceFeature) {

                locations = (child as SXSequenceFeature).locations

            } else if(child instanceof SXSubComponent) {

                locations = (child as SXSubComponent).locations

            } else {

                throw new Error('???')
            
            }

            if(locations.length > 0) {
                return locations
            }

            return [ child ]

        }

        /*
        function reverse(orientation: Orientation): Orientation {

            return orientation === Orientation.Forward ?
                Orientation.Reverse :
                Orientation.Forward

        }
        */
    }
}




// https://stackoverflow.com/a/21071454/712294
function move(array, from, to) {
    if( to === from ) return array;
  
    var target = array[from];                         
    var increment = to < from ? -1 : 1;
  
    for(var k = from; k != to; k += increment){
      array[k] = array[k + increment];
    }
    array[to] = target;
    return array;
  }
