import { NextFunction, Request, Response } from "express";
import walletsProvider from "../providers/wallets";
import propertyProvider from "../providers/property";

const getTotal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const total = await walletsProvider.getTotal()

    return res.status(200).json({
      responseCode: 200,
      data: total,
      success: true
    })
  }

  catch (error) {
    return res.status(500).json({
      message: error.message ? error.message : 'Unexpected error occure.'
    })
  }
}

const getInEscorw = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inEscorw = await propertyProvider.get('inEscorw')

    return res.status(200).json({
      responseCode: 200,
      data: inEscorw,
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
  getTotal,
  getInEscorw,
};