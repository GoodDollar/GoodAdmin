import { NextFunction, Request, Response } from "express";
import surveyProvider from "../providers/survey";

const getTotalPerDay = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const skip = (req.query.skip) ? req.query.skip : 0
    const limit = (req.query.limit) ? req.query.limit : 20
    let data = await surveyProvider.getAll(+skip, +limit)

    return res.status(200).json({
      responseCode: 200,
      data,
      success: true
    })
  }

  catch (error) {
    return res.status(500).json({
      message: error.message ? error.message : 'Unexpected error occure.'
    })
  }
}


export default {
  getTotalPerDay
};